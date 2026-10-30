"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import { useCredits } from "./context";

const USAGE_LABELS: { key: "lead_enriched" | "outreach_sent" | "graph_query"; label: string }[] = [
  { key: "lead_enriched", label: "Verified leads" },
  { key: "outreach_sent", label: "Outreach sent" },
  { key: "graph_query", label: "Graph queries" },
];

export function CreditsMeter() {
  const { credits } = useCredits();
  if (!credits) return <div className="h-6 w-48 animate-pulse rounded bg-neutral-100" />;

  const pct = credits.granted > 0 ? Math.min(100, (credits.balance / credits.granted) * 100) : 0;
  const totalUsed = credits.granted - credits.balance;
  const verified = credits.used.lead_enriched;
  const perLead = verified > 0 ? totalUsed / verified : null;
  const low = pct < 15;

  return (
    <div className="flex items-center gap-3">
      {credits.blocked && (
        <span className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[12px] font-medium text-rose-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          Enrichment paused — out of credits
        </span>
      )}
      <Tooltip.Provider delayDuration={150}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-neutral-50" aria-label="Credits">
              <span className="text-[11px] uppercase tracking-wide text-neutral-500">Credits</span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-neutral-200">
                <span
                  className={clsx("block h-full rounded-full", credits.blocked ? "bg-rose-600" : low ? "bg-amber-500" : "bg-emerald-600")}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className={clsx("text-[12px] tabular-nums", credits.blocked && "text-rose-600")}>
                {credits.balance}
                <span className="text-neutral-400"> / {credits.granted}</span>
              </span>
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              sideOffset={6}
              className="z-50 w-56 rounded-md border border-neutral-200 bg-white p-3 text-[12px] shadow-sm"
            >
              <div className="mb-2 font-medium">Usage by event (Flexprice)</div>
              <table className="w-full tabular-nums">
                <tbody>
                  {USAGE_LABELS.map((u) => (
                    <tr key={u.key}>
                      <td className="py-0.5 text-neutral-600">{u.label}</td>
                      <td className="py-0.5 text-right">{credits.used[u.key]}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-neutral-200">
                    <td className="pt-1 text-neutral-600">Used of granted</td>
                    <td className="pt-1 text-right">{totalUsed}</td>
                  </tr>
                </tbody>
              </table>
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      <div className="hidden items-center gap-2 text-[12px] text-neutral-600 lg:flex">
        <span className="tabular-nums">
          <span className="text-neutral-900">{verified}</span> verified leads
        </span>
        <span className="rounded-full border border-neutral-200 px-2 py-0.5 tabular-nums" title="Credits used ÷ verified leads">
          {perLead === null ? "—" : `$${perLead.toFixed(2)}`} per verified lead
        </span>
      </div>
    </div>
  );
}
