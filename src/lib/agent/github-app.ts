// GitHub App client for customer repository authorization (pure; fetch injected).
//
// Separate from the public-monitoring GITHUB_TOKEN, which is never used for customer
// repositories. The App asks only for read permissions (metadata, contents, pull
// requests): Claude does its own repository work through the customer's Claude
// GitHub connection; SignalForge only maps a product to a repository and checks the
// pull request an agent reports.
//
// Installation ownership is verified with the user-to-server token GitHub returns
// at install time ("Request user authorization (OAuth) during installation"): the
// installation must appear in GET /user/installations for the user who installed it,
// so an installation id can't be claimed by someone who doesn't have access to it.

import { createSign } from "node:crypto";

type FetchLike = typeof fetch;
const API = "https://api.github.com";
const HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "SignalForge" };

export interface AppCredentials {
  appId: string;
  privateKeyPem: string;
  clientId: string;
  clientSecret: string;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** RS256 app JWT, valid 9 minutes (GitHub allows 10), issued 60 s in the past for clock drift. */
export function appJwt(appId: string, privateKeyPem: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 540, iss: appId }));
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64url(sign.sign(privateKeyPem))}`;
}

async function gh<T>(f: FetchLike, path: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  let res: Response;
  try {
    res = await f(`${API}${path}`, { ...init, headers: { ...HEADERS, ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(20_000) });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: (await res.json()) as T };
}

/** Exchanges the install-time OAuth code for a user token (used once, never stored). */
export async function exchangeUserCode(c: AppCredentials, code: string, f: FetchLike = fetch): Promise<string | null> {
  let res: Response;
  try {
    res = await f("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, code }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return null;
  }
  const j = (await res.json().catch(() => null)) as { access_token?: string } | null;
  return res.ok && j?.access_token ? j.access_token : null;
}

export interface InstallationInfo {
  id: number;
  account: string;
  repositorySelection: "all" | "selected";
  permissions: Record<string, string>;
}

/** The installation, only if the user who just installed it can access it. */
export async function verifyUserInstallation(userToken: string, installationId: number, f: FetchLike = fetch): Promise<InstallationInfo | null> {
  for (let page = 1; page <= 5; page++) {
    const r = await gh<{ installations: Array<{ id: number; account: { login: string }; repository_selection: "all" | "selected"; permissions: Record<string, string> }> }>(
      f, `/user/installations?per_page=100&page=${page}`, { headers: { authorization: `Bearer ${userToken}` } });
    if (!r.ok) return null;
    const hit = r.data.installations.find((i) => i.id === installationId);
    if (hit) return { id: hit.id, account: hit.account.login, repositorySelection: hit.repository_selection, permissions: hit.permissions };
    if (r.data.installations.length < 100) break;
  }
  return null;
}

export async function installationToken(c: AppCredentials, installationId: number, f: FetchLike = fetch): Promise<string | null> {
  const r = await gh<{ token: string }>(f, `/app/installations/${installationId}/access_tokens`, {
    method: "POST", headers: { authorization: `Bearer ${appJwt(c.appId, c.privateKeyPem)}` },
  });
  return r.ok ? r.data.token : null;
}

export interface RepoInfo { id: number; fullName: string; defaultBranch: string; private: boolean }

export async function listInstallationRepos(token: string, f: FetchLike = fetch): Promise<RepoInfo[] | null> {
  const out: RepoInfo[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await gh<{ repositories: Array<{ id: number; full_name: string; default_branch: string; private: boolean }> }>(
      f, `/installation/repositories?per_page=100&page=${page}`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    out.push(...r.data.repositories.map((x) => ({ id: x.id, fullName: x.full_name, defaultBranch: x.default_branch, private: x.private })));
    if (r.data.repositories.length < 100) break;
  }
  return out;
}

export interface PullRequestInfo { state: "open" | "closed" | "merged"; headRef: string; baseRef: string; draft: boolean }

export async function getPullRequest(token: string, fullName: string, number: number, f: FetchLike = fetch): Promise<PullRequestInfo | null> {
  const r = await gh<{ state: "open" | "closed"; merged: boolean; head: { ref: string }; base: { ref: string }; draft: boolean }>(
    f, `/repos/${fullName}/pulls/${number}`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return { state: r.data.merged ? "merged" : r.data.state, headRef: r.data.head.ref, baseRef: r.data.base.ref, draft: r.data.draft };
}

/** Pull requests created at or after `since` (newest first, up to 100). */
export async function pullRequestsSince(token: string, fullName: string, since: string, f: FetchLike = fetch): Promise<Array<{ number: number; headRef: string; createdAt: string }> | null> {
  const r = await gh<Array<{ number: number; created_at: string; head: { ref: string } }>>(
    f, `/repos/${fullName}/pulls?state=all&sort=created&direction=desc&per_page=100`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const t = Date.parse(since);
  return r.data.filter((p) => Date.parse(p.created_at) >= t).map((p) => ({ number: p.number, headRef: p.head.ref, createdAt: p.created_at }));
}

export const installUrl = (slug: string, state: string) => `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
