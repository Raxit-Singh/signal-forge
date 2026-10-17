import "server-only";
import { serverEnv } from "@/lib/server/env";
import { getUser } from "@/lib/server/session";

/** SignalForge staff: a confirmed account whose email is in SIGNALFORGE_STAFF_EMAILS. */
export async function isStaff(): Promise<boolean> {
  const user = await getUser();
  if (!user?.email || !user.email_confirmed_at) return false;
  const allowed = serverEnv().SIGNALFORGE_STAFF_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(user.email.toLowerCase());
}
