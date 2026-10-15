import { PageHeader } from "@/components/page";
import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 md:grid-cols-[180px_1fr]">
        <SettingsNav />
        <div className="grid min-w-0 content-start gap-4">{children}</div>
      </div>
    </>
  );
}
