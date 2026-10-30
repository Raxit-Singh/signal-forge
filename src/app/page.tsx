import type { Metadata } from "next";
import { getUser } from "@/lib/server/session";
import { Landing } from "@/components/landing/landing";

export const metadata: Metadata = {
  title: { absolute: "Heardex · Heard. Indexed. Fixed." },
  description: "Heardex finds what people say about your product across Reddit, Hacker News, GitHub, app stores and more, and ranks it into bugs, requests and complaints.",
};

export default async function Home() {
  const user = await getUser();
  return <Landing signedIn={Boolean(user)} />;
}
