"use client";

import { useEffect } from "react";
import { useLinkStatus } from "next/link";

let pendingCount = 0;

/**
 * While `pending` is true, marks the page as loading (html[data-nav-pending]): a thin bar runs along the top and the
 * page content dims a little after a short delay (globals.css), so a slow server render never looks like a dead click.
 */
export function useNavPending(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    const root = document.documentElement;
    pendingCount++;
    root.setAttribute("data-nav-pending", "");
    return () => {
      pendingCount = Math.max(0, pendingCount - 1);
      if (pendingCount === 0) root.removeAttribute("data-nav-pending");
    };
  }, [pending]);
}

/** Inside a <Link>: shows the loading cue while that link's page is on its way. */
export function LinkPending() {
  const { pending } = useLinkStatus();
  useNavPending(pending);
  return null;
}
