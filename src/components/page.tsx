import Link from "next/link";
import { CircleDashed, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="rise mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1.5">
        <h1 className="text-[30px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[36px]">{title}</h1>
        {description && <p className="text-[14px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon = CircleDashed, title, children, action,
}: {
  icon?: LucideIcon;
  title: string;
  children: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <div className="max-w-md text-[13px] text-muted-foreground">{children}</div>
      {action && (
        <Button asChild variant="secondary" className="mt-1">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </Card>
  );
}
