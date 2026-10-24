import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Obsidian } from "./obsidian";

// Design sample on sample data. Never served in production; removed once the direction is applied.
export const metadata: Metadata = { title: "Obsidian sample" };

export default function ObsidianSample() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Obsidian />;
}
