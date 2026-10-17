// Discord: messages in channels a server admin chose, read by SignalForge's bot
// after the admin installed it (Discord's OAuth2 bot flow, View Channels + Read
// Message History only). Discord has no search API for bots, so the bot reads
// each chosen channel's history since the last check. Read-only.
//
// Message text needs Discord's Message Content intent enabled for the bot (and
// Discord's approval once the bot is in 100+ servers); without it messages come
// back empty and the check says so instead of storing blanks.

import { CAPS } from "./capabilities.ts";
import { SourceError } from "./errors.ts";
import type { CandidateMention, SourceAdapter } from "./types.ts";

export const DISCORD_API = "https://discord.com/api/v10";
/** VIEW_CHANNEL (1 << 10) + READ_MESSAGE_HISTORY (1 << 16): nothing that can post or moderate. */
export const DISCORD_BOT_PERMISSIONS = String((1 << 10) | (1 << 16));
const DISCORD_EPOCH = 1420070400000n;

export interface DiscordConfig {
  guild_id: string;
  guild_name?: string;
  channels: Array<{ id: string; name: string }>;
  /** "all": every message in the chosen channels; "keywords": only messages with the product's keywords. */
  mode?: "all" | "keywords";
}

export function parseDiscordConfig(raw: Record<string, unknown> | null | undefined): DiscordConfig | null {
  if (!raw || typeof raw.guild_id !== "string" || !/^\d{15,22}$/.test(raw.guild_id)) return null;
  const channels = Array.isArray(raw.channels)
    ? (raw.channels as Array<Record<string, unknown>>).filter((c) => typeof c.id === "string" && /^\d{15,22}$/.test(c.id as string))
      .map((c) => ({ id: c.id as string, name: String(c.name ?? "channel").slice(0, 100) }))
    : [];
  return { guild_id: raw.guild_id, guild_name: typeof raw.guild_name === "string" ? raw.guild_name : undefined, channels, mode: raw.mode === "keywords" ? "keywords" : "all" };
}

/** Smallest snowflake at a time (Discord ids encode their creation time). */
export function snowflakeAt(t: Date): string {
  return ((BigInt(t.getTime()) - DISCORD_EPOCH) << 22n).toString();
}

export interface DiscordMessage {
  id: string;
  channel_id?: string;
  content?: string;
  timestamp?: string;
  type?: number;
  webhook_id?: string;
  author?: { id?: string; username?: string; global_name?: string | null; bot?: boolean };
  message_reference?: { message_id?: string };
  reactions?: Array<{ count?: number }>;
}

export function normalizeDiscordMessage(m: DiscordMessage, guildId: string, channel: { id: string; name: string }, matchAll: boolean, productName: string): CandidateMention | null {
  if (m.author?.bot || m.webhook_id) return null;              // bots and integrations aren't community feedback
  if (m.type !== undefined && m.type !== 0 && m.type !== 19) return null; // joins, pins, boosts…
  const text = (m.content ?? "").trim();
  const at = m.timestamp ? new Date(m.timestamp) : null;
  if (!text || !at || Number.isNaN(at.getTime())) return null;
  const reactions = (m.reactions ?? []).reduce((s, r) => s + Number(r.count ?? 0), 0);
  return {
    externalId: `msg:${m.id}`,
    sourceUrl: `https://discord.com/channels/${guildId}/${channel.id}/${m.id}`,
    parentExternalId: m.message_reference?.message_id ? `msg:${m.message_reference.message_id}` : null,
    authorExternalId: m.author?.id ?? null,
    authorDisplay: m.author?.global_name || m.author?.username || null,
    title: null,
    content: text.slice(0, 4000),
    publishedAt: at,
    engagement: { reactions },
    engagementScore: reactions,
    matchText: text,
    mentionType: "community_message",
    collectionMethod: "keyword_search",
    linkTarget: "item",
    community: `#${channel.name}`,
    ...(matchAll ? { directlyAbout: { reason: `Message in #${channel.name} on ${productName}'s Discord`, score: 0.8 } } : {}),
  };
}

export function createDiscordAdapter(botToken: string | undefined): SourceAdapter {
  return {
    id: "discord",
    name: "Discord",
    dataProvider: "official",
    requiresConnection: true,
    streams: [{ id: "messages", label: "Messages in your server's chosen channels", mentionType: "community_message", capabilities: CAPS.discordMessages, queryMode: "product" }],
    configured: () => (botToken ? { ok: true } : { ok: false, reason: "DISCORD_BOT_TOKEN is not set" }),
    rateLimit: () => ({ key: "discord", capacity: 20, refillPerSecond: 5 }),

    async searchMentions(req, ctx) {
      if (!botToken) throw new SourceError("auth", "Discord isn't configured on this server.");
      const cfg = parseDiscordConfig(req.target?.connection?.config);
      if (!cfg) throw new SourceError("auth", "Discord isn't connected for this product.");
      if (!cfg.channels.length) throw new SourceError("bad_request", "Choose at least one Discord channel to monitor.");
      const items: CandidateMention[] = [];
      let pages = 0;
      let complete = true;
      let emptyContent = 0;
      let seen = 0;
      const maxPages = Math.min(CAPS.discordMessages.maxPagesPerRun, req.maxPages) * cfg.channels.length;
      for (const ch of cfg.channels) {
        let after = snowflakeAt(req.window.since);
        for (let page = 0; ; page++) {
          if (pages >= maxPages || page >= CAPS.discordMessages.maxPagesPerRun) {
            complete = false;
            break;
          }
          const res = await ctx.request({
            url: `${DISCORD_API}/channels/${ch.id}/messages?${new URLSearchParams({ limit: "100", after })}`, endpoint: "messages",
            headers: { Authorization: `Bot ${botToken}`, "User-Agent": "DiscordBot (https://signalforge.app, 1.0)" }, signal: req.signal,
          });
          pages++;
          if (res.status === 401) throw new SourceError("auth", "Discord rejected SignalForge's bot token.");
          if (res.status === 403 || res.status === 404) throw new SourceError("auth", `The bot can't read #${ch.name}. Check it still has View Channel and Read Message History there.`);
          if (res.status === 429) {
            const retry = Number(res.headers.get("retry-after"));
            throw new SourceError("rate_limited", "Discord is rate limiting the bot.", { retryAfterSeconds: Number.isFinite(retry) ? Math.ceil(retry) : 5 });
          }
          if (!res.ok) throw new SourceError("transient", `Discord request failed (${res.status}).`);
          const batch = (await res.json()) as DiscordMessage[];
          if (!Array.isArray(batch) || batch.length === 0) break;
          for (const m of batch) {
            seen++;
            if (!m.author?.bot && !m.webhook_id && !(m.content ?? "").trim() && (m.type === 0 || m.type === 19)) emptyContent++;
            const n = normalizeDiscordMessage(m, cfg.guild_id, ch, cfg.mode !== "keywords", req.terms[0] ?? "your product");
            if (n && n.publishedAt < req.window.until) items.push(n);
          }
          // `after` pages forward in time: continue from the newest id seen.
          after = batch.reduce((max, m) => (BigInt(m.id) > BigInt(max) ? m.id : max), after);
          if (batch.length < 100) break;
        }
      }
      if (seen > 0 && emptyContent === seen) {
        throw new SourceError("auth", "Discord returned messages without their text: turn on the Message Content intent for SignalForge's bot.");
      }
      return {
        items, complete, saturated: !complete, pagesRequested: pages,
        incompleteReason: complete ? undefined : "More Discord messages than one check reads; the rest are read next time.",
      };
    },

    async validateCredentials() {},
  };
}
