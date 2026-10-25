import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 pb-10">
      <div className="rise grid gap-1.5">
        <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">Settings</h1>
        <p className="text-[14px] text-muted-foreground">Your workspace, products, intelligence and plan.</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="md:sticky md:top-20 md:self-start"><SettingsNav /></aside>
        <div className="rise grid min-w-0 content-start gap-4" style={{ ["--d" as string]: "80ms" }}>{children}</div>
      </div>
    </div>
  );
}
