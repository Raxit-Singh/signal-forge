import {
  AtSign, Cloud, Code, Facebook, Github, Globe, Instagram, Layers, Linkedin, MessageCircle, Music2, Newspaper, Play, Rss,
  Smartphone, Star, Twitter, Youtube, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// One recognisable mark per platform. Colours are each platform's own brand hue,
// used only on the small tile behind the glyph.
const ICONS: Record<string, { icon: LucideIcon; color: string }> = {
  hackernews: { icon: Rss, color: "#ff6600" },
  github: { icon: Github, color: "#24292f" },
  stackexchange: { icon: Layers, color: "#f48024" },
  youtube: { icon: Youtube, color: "#ff0000" },
  bluesky: { icon: Cloud, color: "#1185fe" },
  dev: { icon: Code, color: "#0a0a0a" },
  app_store: { icon: Smartphone, color: "#0d96f6" },
  google_play: { icon: Play, color: "#01875f" },
  reddit: { icon: MessageCircle, color: "#ff4500" },
  x: { icon: Twitter, color: "#0f1419" },
  linkedin: { icon: Linkedin, color: "#0a66c2" },
  tiktok: { icon: Music2, color: "#111111" },
  instagram: { icon: Instagram, color: "#d62976" },
  facebook: { icon: Facebook, color: "#1877f2" },
  substack: { icon: Rss, color: "#ff6719" },
  web: { icon: Globe, color: "#4285f4" },
  news: { icon: Newspaper, color: "#5f6368" },
  trustpilot: { icon: Star, color: "#00b67a" },
  discord: { icon: AtSign, color: "#5865f2" },
};

export function PlatformIcon({ id, className }: { id: string; className?: string }) {
  const { icon: Icon, color } = ICONS[id] ?? { icon: Globe, color: "#6b7280" };
  return (
    <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-md text-white", className)} style={{ backgroundColor: color }} aria-hidden>
      <Icon className="size-4" />
    </span>
  );
}
