"use client";

import clsx from "clsx";
import { ArrowRightLeft, Brain, CheckCircle2, Gauge, Network, PanelRightClose, Search } from "lucide-react";
import type { ThinkingStep } from "@/lib/types";
import { useThinking } from "./context";

const KIND_ICON: Record<ThinkingStep["kind"], React.ComponentType<{ className?: string }>> = {
  reason: Brain,
  search: Search,
  graph: Network,
  validate: CheckCircle2,
  meter: Gauge,
  handoff: ArrowRightLeft,
};

const AGENT_TONE: Record<string, string> = {
  planner: "bg-neutral-900 text-white",
  icp: "bg-emerald-50 text-emerald-700 border-emerald-200",
  discovery: "bg-sky-50 text-sky-700 border-sky-200",
  enricher: "bg-violet-50 text-violet-700 border-violet-200",
  builder: "bg-neutral-100 text-neutral-700 border-neutral-200",
  reviewer: "bg-amber-50 text-amber-700 border-amber-200",
  security: "bg-rose-50 text-rose-700 border-rose-200",
};

function time(at: string) {
  const d = new Date(at);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ThinkingPanel({ onClose }: { onClose: () => void }) {
  const { steps } = useThinking();
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-white">
      <div className="flex h-12 items-center justify-between border-b border-neutral-200 px-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
          </span>
          <span className="font-serif text-[15px]">Agent Thinking</span>
          <span className="text-[11px] tabular-nums text-neutral-400">{steps.length}</span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-neutral-500 hover:bg-neutral-100" aria-label="Collapse panel">
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>
      <ol className="flex-1 overflow-y-auto">
        {steps.length === 0 && <li className="p-4 text-[12px] text-neutral-500">Waiting for agents…</li>}
        {steps.map((s) => {
          const Icon = KIND_ICON[s.kind] ?? Brain;
          return (
            <li key={s.id} className="wp-fade-in border-b border-neutral-100 px-4 py-2.5">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={clsx(
                    "rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
                    AGENT_TONE[s.agent] ?? "border-neutral-200 bg-neutral-50 text-neutral-700",
                  )}
                >
                  {s.agent}
                </span>
                <Icon className="h-3.5 w-3.5 text-neutral-400" />
                <span className="text-[10px] text-neutral-400">{s.kind}</span>
                <span className="ml-auto text-[10px] tabular-nums text-neutral-400">{time(s.at)}</span>
              </div>
              <p className="text-[12px] leading-snug text-neutral-800">{s.text}</p>
              {s.cypher && (
                <pre className="mt-1.5 overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-2 font-mono text-[10.5px] leading-relaxed text-neutral-700">
                  {s.cypher}
                </pre>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
