import localFont from "next/font/local";

/** The landing and marketing pages' typeface. */
export const switzer = localFont({
  src: [
    { path: "./fonts/Switzer-400.woff2", weight: "400" },
    { path: "./fonts/Switzer-500.woff2", weight: "500" },
    { path: "./fonts/Switzer-600.woff2", weight: "600" },
  ],
  display: "swap",
});
