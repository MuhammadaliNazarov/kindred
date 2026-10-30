"use client";

import clsx from "clsx";
import type { Company, Signal } from "@/lib/types";
import { signalLabel } from "./cells";

export type DiscoveryFilters = {
  tiers: Company["tier"][];
  industry: string; // "" = all
  signal: Signal["type"] | ""; // "" = all
  verifiedOnly: boolean;
  showDropped: boolean; // show claims the validator rejected (demo)
};

export const DEFAULT_FILTERS: DiscoveryFilters = { tiers: ["A", "B", "C"], industry: "", signal: "", verifiedOnly: false, showDropped: false };

const SIGNAL_TYPES: Signal["type"][] = ["funding", "exec_hire", "job_post", "tech_change", "launch", "churn_risk"];

export function applyFilters(companies: Company[], f: DiscoveryFilters): Company[] {
  return companies.filter((c) => {
    if (!f.tiers.includes(c.tier)) return false;
    if (f.industry && c.industry !== f.industry) return false;
    if (f.signal && !c.signals.some((s) => s.type === f.signal)) return false;
    if (f.verifiedOnly) {
      const any = c.sources.some((s) => s.verified) || c.signals.some((s) => s.source.verified);
      if (!any) return false;
    }
    return true;
  });
}

export function Filters({
  value,
  onChange,
  industries,
  count,
  total,
}: {
  value: DiscoveryFilters;
  onChange: (f: DiscoveryFilters) => void;
  industries: string[];
  count: number;
  total: number;
}) {
  const toggleTier = (t: Company["tier"]) =>
    onChange({ ...value, tiers: value.tiers.includes(t) ? value.tiers.filter((x) => x !== t) : [...value.tiers, t] });

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 px-4 py-2 text-[12px]">
      <div className="flex items-center gap-1">
        <span className="mr-1 text-neutral-500">Tier</span>
        {(["A", "B", "C"] as const).map((t) => {
          const on = value.tiers.includes(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleTier(t)}
              className={clsx(
                "h-6 w-7 rounded-sm border font-medium",
                on && t === "A" && "border-emerald-600 bg-emerald-600 text-white",
                on && t === "B" && "border-amber-500 bg-amber-500 text-[#1a1300]",
                on && t === "C" && "border-neutral-400 bg-neutral-200 text-neutral-800",
                !on && "border-neutral-200 text-neutral-400",
              )}
            >
              {t}
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-1.5">
        <span className="text-neutral-500">Industry</span>
        <select
          value={value.industry}
          onChange={(e) => onChange({ ...value, industry: e.target.value })}
          className="h-6 rounded-sm border border-neutral-200 bg-surface px-1"
        >
          <option value="">All</option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-neutral-500">Signal</span>
        <select
          value={value.signal}
          onChange={(e) => onChange({ ...value, signal: e.target.value as DiscoveryFilters["signal"] })}
          className="h-6 rounded-sm border border-neutral-200 bg-surface px-1"
        >
          <option value="">Any</option>
          {SIGNAL_TYPES.map((s) => (
            <option key={s} value={s}>
              {signalLabel(s)}
            </option>
          ))}
        </select>
      </label>

      <Switch on={value.verifiedOnly} onToggle={() => onChange({ ...value, verifiedOnly: !value.verifiedOnly })} label="Verified sources only" />
      <Switch on={value.showDropped} onToggle={() => onChange({ ...value, showDropped: !value.showDropped })} label="Show dropped claims" tone="rose" />

      <span className="ml-auto tabular-nums text-neutral-500">
        <span className="font-medium text-neutral-900">{count}</span> of {total} accounts
      </span>
    </div>
  );
}

function Switch({ on, onToggle, label, tone = "emerald" }: { on: boolean; onToggle: () => void; label: string; tone?: "emerald" | "rose" }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className="flex select-none items-center gap-1.5">
      <span
        className={clsx(
          "relative h-4 w-7 rounded-full transition-colors",
          on ? (tone === "rose" ? "bg-rose-600" : "bg-emerald-600") : "bg-neutral-300",
        )}
      >
        <span className={clsx("absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all", on ? "left-3.5" : "left-0.5")} />
      </span>
      <span className="text-neutral-700">{label}</span>
    </button>
  );
}
