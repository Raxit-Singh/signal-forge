import { PlatformMark } from "@/components/brand-logo";

/** One recognisable mark per platform: its logo in brand colour. */
export function PlatformIcon({ id, className }: { id: string; className?: string }) {
  return <PlatformMark source={id} className={className} />;
}
