"use client";

import { useEffect, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import { useCredits } from "./context";

const USAGE_LABELS: { key: "lead_enriched" | "outreach_sent" | "graph_query"; label: string }[] = [
  { key: "lead_enriched", label: "Verified leads" },
  { key: "outreach_sent", label: "Outreach sent" },
  { key: "graph_query", label: "Graph queries" },
];

/** A number that ticks when it changes (re-mounts the span so the keyframe replays). */
function Tick({ value, className }: { value: number | string; className?: string }) {
  const [key, setKey] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setKey((k) => k + 1);
    }
  }, [value]);
  return (
    <span key={key} className={clsx("wp-tick tabular-nums", className)}>
      {value}
    </span>
  );
}

export function CreditsMeter() {
  const { credits } = useCredits();
  const wasBlocked = useRef(false);
  const [ring, setRing] = useState(false);

  useEffect(() => {
    if (credits?.blocked && !wasBlocked.current) setRing(true);
    wasBlocked.current = !!credits?.blocked;
  }, [credits?.blocked]);

  if (!credits) return <div className="wp-skeleton h-6 w-48" />;

  const pct = credits.granted > 0 ? Math.min(100, (credits.balance / credits.granted) * 100) : 0;
  const totalUsed = credits.granted - credits.balance;
  // The API meters credits (5 per enrichment); the offline seed counts leads. Show a lead count either way.
  const verified = Math.round(credits.used.lead_enriched / (process.env.NEXT_PUBLIC_API_URL ? 5 : 1));
  const perLead = verified > 0 ? totalUsed / verified : null;
  const low = pct < 15;

  return (
    <div className="flex min-w-0 items-center gap-3">
      {credits.blocked && (
        <span
          className={clsx(
            "wp-fade-in flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-rose-200 bg-rose-50 px-2 text-[12px] font-medium text-rose-300",
            ring && "wp-pulse-ring",
          )}
          onAnimationEnd={() => setRing(false)}
          role="status"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>Enrichment paused</span>
          <span className="hidden font-normal text-rose-300 2xl:inline">· out of credits</span>
        </span>
      )}
      <Tooltip.Provider delayDuration={150}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button className="no-press flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 hover:bg-black/[0.04]" aria-label="Credits">
              <span className="text-[12px] text-neutral-500">Credits</span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[#e6e9f2]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Credits remaining">
                <span
                  className={clsx(
                    "block h-full w-full origin-left rounded-full transition-[transform,background-color] duration-[600ms] ease-[cubic-bezier(0.77,0,0.175,1)]",
                    credits.blocked ? "bg-rose-600" : low ? "bg-amber-500" : "bg-gradient-to-r from-accent to-[#5b7cff]",
                  )}
                  style={{ transform: `scaleX(${pct / 100})` }}
                />
              </span>
              <span className={clsx("text-[12px] tabular-nums", credits.blocked && "font-medium text-rose-300")}>
                <Tick value={credits.balance} />
                <span className="text-neutral-400"> / {credits.granted}</span>
              </span>
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              sideOffset={6}
              className="glass-3 z-50 w-56 rounded-[16px] p-3 text-[12px]"
            >
              <div className="mb-2 font-medium">Usage by event (Flexprice)</div>
              <table className="w-full tabular-nums">
                <tbody>
                  {USAGE_LABELS.map((u) => (
                    <tr key={u.key}>
                      <td className="py-0.5 text-neutral-600">{u.label}</td>
                      <td className="py-0.5 text-right">{u.key === "lead_enriched" ? verified : credits.used[u.key]}</td>
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
      <div className="hidden shrink-0 items-center gap-2 whitespace-nowrap text-[12px] text-neutral-600 lg:flex">
        <span className="tabular-nums">
          <Tick value={verified} className="text-neutral-900" /> verified
        </span>
        <span className="rounded-full border border-neutral-200 px-2 py-0.5 tabular-nums" title="Credits used ÷ verified leads">
          {perLead === null ? "—" : `${perLead.toFixed(1)} cr`} / lead
        </span>
      </div>
    </div>
  );
}
