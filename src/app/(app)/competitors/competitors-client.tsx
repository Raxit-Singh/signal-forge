"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { addCompetitorAction, removeCompetitorAction, updateCompetitorAction } from "@/app/actions/competitors";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };

export function VolumeChart({ rows, entities }: { rows: Array<Record<string, number | string>>; entities: Array<{ id: string; name: string; color: string }> }) {
  return (
    <div className="grid gap-3">
      <div className="h-64 w-full min-w-0" role="img" aria-label="Relevant mentions per day for the product and each competitor, on sources monitored for all of them. A data table follows.">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
            <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ stroke: "var(--border)" }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]!.payload as Record<string, number | string>;
              return (
                <div className="grid gap-1 rounded-md border bg-surface px-2.5 py-2 text-xs shadow-sm">
                  <p className="font-medium">{r.day}</p>
                  {entities.map((e) => (
                    <p key={e.id} className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: e.color }} aria-hidden />{e.name}</span>
                      <span className="tabular">{r[e.id] ?? 0}</span>
                    </p>
                  ))}
                </div>
              );
            }} />
            {entities.map((e) => (
              <Line key={e.id} type="monotone" dataKey={e.id} name={e.name} stroke={e.color} strokeWidth={2} dot={false}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {entities.map((e) => (
          <li key={e.id} className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: e.color }} aria-hidden />{e.name}</li>
        ))}
      </ul>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Relevant mentions per day</caption>
            <thead className="text-muted-foreground">
              <tr><th scope="col" className="py-1 pr-2 font-medium">Day</th>{entities.map((e) => <th key={e.id} scope="col" className="py-1 pr-2 text-right font-medium">{e.name}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={String(r.day)}><td className="py-1 pr-2">{r.day}</td>{entities.map((e) => <td key={e.id} className="py-1 pr-2 text-right tabular">{r[e.id] ?? 0}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function AddCompetitorForm({ productId, disabledReason }: { productId: string; disabledReason: string | null }) {
  const [state, action] = useFormAction(addCompetitorAction, idle);
  return (
    <form action={action} className="grid gap-3" data-testid="add-competitor">
      <input type="hidden" name="productId" value={productId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="name" label="Competitor name" state={state} required maxLength={80} placeholder="e.g. Acme Analytics" />
        <Field name="websiteUrl" label="Website" state={state} optional type="url" placeholder="https://" />
        <Field name="keywords" label="Extra keywords" state={state} optional placeholder="acme.io, Acme app" hint="Up to 2, comma-separated. The name is always searched." />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton size="sm" pendingLabel="Adding…" disabled={Boolean(disabledReason)}>Add competitor</SubmitButton>
        {disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function CompetitorControls({ c }: { c: { id: string; name: string; websiteUrl: string | null; keywords: string[]; enabled: boolean } }) {
  const [saveState, save] = useFormAction(updateCompetitorAction, idle);
  const [toggleState, toggle] = useFormAction(updateCompetitorAction, idle);
  const [removeState, remove] = useFormAction(removeCompetitorAction, idle);
  const extra = c.keywords.filter((k) => k.toLowerCase() !== c.name.toLowerCase());
  const hidden = (enabled: boolean) => (
    <>
      <input type="hidden" name="competitorId" value={c.id} />
      <input type="hidden" name="name" value={c.name} />
      <input type="hidden" name="websiteUrl" value={c.websiteUrl ?? ""} />
      <input type="hidden" name="keywords" value={extra.join(", ")} />
      <input type="hidden" name="enabled" value={String(enabled)} />
    </>
  );
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={toggle}>
          {hidden(!c.enabled)}
          <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">{c.enabled ? "Pause" : "Resume"}</SubmitButton>
        </form>
        <details className="group">
          <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted">Edit</summary>
          <form action={save} className="mt-2 grid gap-2 rounded-md border p-3">
            <input type="hidden" name="competitorId" value={c.id} />
            <input type="hidden" name="enabled" value={String(c.enabled)} />
            <Field name="name" label="Name" state={saveState} defaultValue={c.name} required maxLength={80} />
            <Field name="websiteUrl" label="Website" state={saveState} optional type="url" defaultValue={c.websiteUrl ?? ""} />
            <Field name="keywords" label="Extra keywords" state={saveState} optional defaultValue={extra.join(", ")} hint="Up to 2, comma-separated." />
            <SubmitButton size="sm" pendingLabel="Saving…">Save</SubmitButton>
            <FormMessage state={saveState} />
          </form>
        </details>
        <form action={remove} onSubmit={(e) => {
          if (!window.confirm(`Remove ${c.name}? Its collected mentions are deleted.`)) e.preventDefault();
        }}>
          <input type="hidden" name="competitorId" value={c.id} />
          <SubmitButton size="sm" variant="ghost" pendingLabel="Removing…">Remove</SubmitButton>
        </form>
      </div>
      <FormMessage state={toggleState} />
      <FormMessage state={removeState} />
    </div>
  );
}
