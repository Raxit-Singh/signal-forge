import { redirect } from "next/navigation";
import { getUser } from "@/lib/server/session";

export default async function Home() {
  const user = await getUser();
  redirect(user ? "/overview" : "/login");
}
