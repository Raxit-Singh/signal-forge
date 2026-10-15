// AI provider catalog and key-shape checks. Shape checks only catch typos;
// real validation (a minimal API call) happens server-side in Milestone 4.

export type AiProvider = "signalforge" | "anthropic" | "openai" | "gemini";
export type ByokProvider = Exclude<AiProvider, "signalforge">;

export interface AiProviderInfo {
  provider: AiProvider;
  name: string;
  keyUrl?: string;
  keyPattern?: RegExp;
  keyExample?: string;
}

export const AI_PROVIDERS: readonly AiProviderInfo[] = [
  { provider: "signalforge", name: "SignalForge AI credits" },
  {
    provider: "anthropic",
    name: "Anthropic (Claude)",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,300}$/,
    keyExample: "sk-ant-…",
  },
  {
    provider: "openai",
    name: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPattern: /^sk-[A-Za-z0-9_-]{20,300}$/,
    keyExample: "sk-…",
  },
  {
    provider: "gemini",
    name: "Google Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPattern: /^[A-Za-z0-9_-]{30,100}$/,
    keyExample: "AIza…",
  },
];

export function isByokProvider(p: string): p is ByokProvider {
  return p === "anthropic" || p === "openai" || p === "gemini";
}

export function checkKeyShape(provider: ByokProvider, key: string): { ok: true; key: string } | { ok: false; error: string } {
  const trimmed = key.trim();
  const info = AI_PROVIDERS.find((p) => p.provider === provider);
  if (!info?.keyPattern) return { ok: false, error: "Unknown provider." };
  if (/\s/.test(trimmed)) return { ok: false, error: "The key contains spaces or line breaks." };
  if (provider === "openai" && trimmed.startsWith("sk-ant-")) {
    return { ok: false, error: "That looks like an Anthropic key, not an OpenAI key." };
  }
  if (!info.keyPattern.test(trimmed)) {
    return { ok: false, error: `That doesn't look like a ${info.name} key (expected ${info.keyExample}).` };
  }
  return { ok: true, key: trimmed };
}

/** Last four characters, the only part of a key ever shown back to the user. */
export function keyHint(key: string): string {
  return key.trim().slice(-4).replace(/[^A-Za-z0-9_-]/g, "");
}
