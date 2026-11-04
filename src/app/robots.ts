import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    // App pages are noindex on their own; keeping crawlers out of them saves crawl budget.
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/buzz", "/competitors", "/feedback", "/insights", "/mentions", "/monitoring", "/overview", "/reports", "/settings", "/onboarding", "/invite", "/oauth", "/prototypes"] }],
    sitemap: `${publicEnv.NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
