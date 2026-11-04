import type { Metadata } from "next";
import { docBySlug } from "@/content/docs";
import { DocPage } from "./doc-page";

const doc = docBySlug("")!;
export const metadata: Metadata = { title: { absolute: "Heardex docs: getting started" }, description: doc.description };

export default function DocsHome() {
  return <DocPage doc={doc} />;
}
