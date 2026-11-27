"use client";

import { useEffect } from "react";
import { VERIFIED_CHANNEL } from "../wait-for-confirmation";

/** Tells a "Check your email" tab in this browser that the email is confirmed, so it moves on at once. */
export function AnnounceVerified() {
  useEffect(() => {
    try {
      const c = new BroadcastChannel(VERIFIED_CHANNEL);
      c.postMessage("verified");
      c.close();
    } catch {
      // No BroadcastChannel: that tab notices on its next check.
    }
  }, []);
  return null;
}
