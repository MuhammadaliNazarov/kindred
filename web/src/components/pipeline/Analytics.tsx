"use client";

import clsx from "clsx";
import { Badge } from "@/components/outreach/bits";

export type AnalyticsData = {
  byStage: { stage: string; count: number }[];
  byIndustry: { industry: string; matched: number; contacted: number; replied: number; meeting: number }[];
  byTier: { tier: string; matched: number; contacted: number; replied: number; meeting: number }[];
  variants: { variant: string; sent: number; opened: number; replied: number }[];
};

const STAGE_LABEL: Record<string, string> = {
  matched: "Matched",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting",
  closed_won: "Won",
  closed_lost: "Lost",
};

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
const fmtPct = (v: number) => `${v.toFixed(v > 0 && v < 10 ? 1 : 0)}%`;

function Bar({ value, tone = "neutral" }: { value: number; tone?: "neutral" | "ok" }) {
  return (
    <div className="h-1.5 w-full bg-neutral-100">
      <div className={clsx("h-full", tone === "ok" ? "bg-emerald-600" : "bg-neutral-800")} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx("border border-neutral-200 bg-white", className)}>
      <h3 className="border-b border-neutral-200 px-3 py-2 font-serif text-[15px] text-neutral-900">{title}</h3>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Funnel({ data }: { data: AnalyticsData["byStage"] }) {
  // Cumulative funnel: a lead in a later stage has passed through the earlier ones.
  const order = ["matched", "contacted", "replied", "meeting", "closed_won"];
  const count = (s: string) => data.find((d) => d.stage === s)?.count ?? 0;
  const lost = count("closed_lost");
  const reached = order.map((s, i) => order.slice(i).reduce((n, x) => n + count(x), 0) + (i < 4 ? lost : 0));
  const top = reached[0] || 1;
  return (
    <Section title="Stage conversion">
      <div className="space-y-1.5">
        {order.map((s, i) => (
          <div key={s} className="grid grid-cols-[80px_1fr_44px_52px] items-center gap-2 text-[12px] tabular-nums">
            <span className="text-neutral-700">{STAGE_LABEL[s]}</span>
            <div className="h-5 bg-neutral-100">
              <div className={clsx("h-full", s === "closed_won" ? "bg-emerald-600" : "bg-neutral-800")} style={{ width: `${pct(reached[i], top)}%` }} />
            </div>
            <span className="text-right text-neutral-900">{reached[i]}</span>
            <span className="text-right text-neutral-500">{i === 0 ? "" : fmtPct(pct(reached[i], reached[i - 1]))}</span>
          </div>
        ))}
        <div className="pt-1 text-[11px] text-neutral-500 tabular-nums">
          Lost: {lost} · right column is step conversion from the stage above
        </div>
      </div>
    </Section>
  );
}

function ConvTable<T extends { matched: number; contacted: number; replied: number; meeting: number }>({
  title,
  rows,
  label,
}: {
  title: string;
  rows: T[];
  label: (r: T) => string;
}) {
  return (
    <Section title={title}>
      <table className="w-full text-[12px] tabular-nums">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-500">
            <th className="pb-1 font-semibold">Segment</th>
            <th className="pb-1 text-right font-semibold">Matched</th>
            <th className="pb-1 text-right font-semibold">Contacted</th>
            <th className="pb-1 text-right font-semibold">Replied</th>
            <th className="pb-1 text-right font-semibold">Meetings</th>
            <th className="w-[120px] pb-1 pl-3 font-semibold">Reply %</th>
            <th className="w-[120px] pb-1 pl-3 font-semibold">Meeting %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const reply = pct(r.replied, r.contacted);
            const meet = pct(r.meeting, r.matched);
            return (
              <tr key={label(r)} className="border-t border-neutral-100">
                <td className="py-1 text-neutral-900">{label(r)}</td>
                <td className="py-1 text-right">{r.matched}</td>
                <td className="py-1 text-right">{r.contacted}</td>
                <td className="py-1 text-right">{r.replied}</td>
                <td className="py-1 text-right">{r.meeting}</td>
                <td className="py-1 pl-3">
                  <div className="flex items-center gap-1.5">
                    <Bar value={reply} />
                    <span className="w-9 text-right text-neutral-600">{fmtPct(reply)}</span>
                  </div>
                </td>
                <td className="py-1 pl-3">
                  <div className="flex items-center gap-1.5">
                    <Bar value={meet} tone="ok" />
                    <span className="w-9 text-right text-neutral-600">{fmtPct(meet)}</span>
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-2 text-neutral-400">
                No data yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Section>
  );
}

export function IndustryTable({ rows }: { rows: AnalyticsData["byIndustry"] }) {
  return <ConvTable title="Conversion by industry" rows={rows} label={(r) => r.industry} />;
}

export function TierTable({ rows }: { rows: AnalyticsData["byTier"] }) {
  return <ConvTable title="Conversion by tier" rows={rows} label={(r) => `Tier ${r.tier}`} />;
}

export function VariantTable({ rows }: { rows: AnalyticsData["variants"] }) {
  const withRates = rows.map((r) => ({ ...r, open: pct(r.opened, r.sent), reply: pct(r.replied, r.sent) }));
  const best = withRates.reduce<(typeof withRates)[number] | null>((b, r) => (!b || r.reply > b.reply ? r : b), null);
  return (
    <Section title="A/B by variant">
      <table className="w-full text-[12px] tabular-nums">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-500">
            <th className="pb-1 font-semibold">Variant</th>
            <th className="pb-1 text-right font-semibold">Sent</th>
            <th className="w-[130px] pb-1 pl-3 font-semibold">Open %</th>
            <th className="w-[130px] pb-1 pl-3 font-semibold">Reply %</th>
            <th className="pb-1" />
          </tr>
        </thead>
        <tbody>
          {withRates.map((r) => {
            const win = best && best.variant === r.variant && r.sent > 0 && withRates.length > 1;
            return (
              <tr key={r.variant} className={clsx("border-t border-neutral-100", win && "bg-emerald-50/60")}>
                <td className="py-1.5 font-medium text-neutral-900">Variant {r.variant}</td>
                <td className="py-1.5 text-right">{r.sent}</td>
                <td className="py-1.5 pl-3">
                  <div className="flex items-center gap-1.5">
                    <Bar value={r.open} />
                    <span className="w-9 text-right text-neutral-600">{fmtPct(r.open)}</span>
                  </div>
                </td>
                <td className="py-1.5 pl-3">
                  <div className="flex items-center gap-1.5">
                    <Bar value={r.reply} tone="ok" />
                    <span className="w-9 text-right text-neutral-600">{fmtPct(r.reply)}</span>
                  </div>
                </td>
                <td className="py-1.5 pl-2 text-right">{win && <Badge tone="ok">Winner</Badge>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}
