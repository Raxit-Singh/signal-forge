import { createClient } from "@/lib/supabase/server";
import { integrationInfo } from "@/lib/domain/integrations";
import { reportCsv, type ReportData } from "@/lib/reports/weekly";
import { uuidSchema } from "@/lib/validation/schemas";

const sourceName = (id: string) => integrationInfo(id as never)?.name ?? id;

/** The report's numbers as CSV (read under the viewer's RLS: only members of the workspace). */
export async function GET(_req: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  if (!uuidSchema.safeParse(reportId).success) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("reports").select("data, period_start").eq("id", reportId).eq("status", "ready").maybeSingle();
  if (!data?.data) return new Response("Not found", { status: 404 });
  const d = data.data as ReportData;
  const name = `${d.product.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report"}-${(data.period_start as string).slice(0, 10)}.csv`;
  return new Response(`﻿${reportCsv(d, sourceName)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
