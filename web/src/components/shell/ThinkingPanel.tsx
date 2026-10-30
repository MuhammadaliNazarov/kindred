"use client";

import clsx from "clsx";
import { ArrowRightLeft, Brain, CheckCircle2, Gauge, Network, PanelRightClose, Search, XCircle } from "lucide-react";
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
  planner: "bg-accent text-white border-accent",
  icp: "bg-emerald-50 text-emerald-300 border-emerald-200",
  discovery: "bg-sky-50 text-sky-300 border-sky-200",
  enricher: "bg-violet-50 text-violet-300 border-violet-200",
  builder: "bg-neutral-100 text-neutral-700 border-neutral-200",
  reviewer: "bg-amber-50 text-amber-300 border-amber-200",
  security: "bg-rose-50 text-rose-300 border-rose-200",
};

const DROPPED = /\b(dropped|quote not found|rejected|failed|blocked)\b/i;

function time(at: string) {
  const d = new Date(at);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ThinkingPanel({ onClose }: { onClose: () => void }) {
  const { steps } = useThinking();
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-neutral-200 bg-white" aria-label="Agent Thinking">
      <div className="flex h-14 shrink-0 items-center justify-between px-4 shadow-[inset_0_-1px_0_#e6e9f0]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute -inset-1 rounded-full bg-emerald-500/25 blur-[3px]" aria-hidden />
            <span className="wp-breathe relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            <span className="sr-only">live</span>
          </span>
          <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-neutral-950">Agent Thinking</span>
          <span className="text-[11px] tabular-nums text-neutral-400">{steps.length}</span>
        </div>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-black/[0.04] hover:text-neutral-950" aria-label="Collapse panel">
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>
      <ol className="flex-1 overflow-y-auto" aria-live="polite">
        {steps.length === 0 && (
          <li className="p-4">
            <div className="flex items-center gap-2 text-[12px] text-neutral-500">
              <span className="wp-skeleton h-3 w-3 rounded-full" />
              Waiting for agents…
            </div>
            <div className="mt-3 space-y-2">
              <div className="wp-skeleton h-3 w-11/12" />
              <div className="wp-skeleton h-3 w-2/3" />
              <div className="wp-skeleton h-3 w-4/5" />
            </div>
          </li>
        )}
        {steps.map((s, i) => {
          const Icon = KIND_ICON[s.kind] ?? Brain;
          const dropped = s.kind === "validate" && DROPPED.test(s.text);
          const latest = i === 0;
          return (
            <li
              key={s.id}
              className={clsx(
                "wp-stream relative px-4 py-2.5 [&+&]:shadow-[inset_0_1px_0_#eef1f6]",
                dropped && "bg-rose-50",
                latest && !dropped && "wp-flash",
              )}
            >
              {dropped && <span className="absolute inset-y-0 left-0 w-0.5 bg-rose-600" aria-hidden />}
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={clsx(
                    "rounded-full border px-2 py-px text-[11px] font-medium",
                    AGENT_TONE[s.agent] ?? "border-neutral-200 bg-neutral-50 text-neutral-700",
                  )}
                >
                  {s.agent}
                </span>
                {dropped ? <XCircle className="h-3.5 w-3.5 text-rose-300" /> : <Icon className="h-3.5 w-3.5 text-neutral-400" />}
                <span className={clsx("text-[11px]", dropped ? "font-medium text-rose-300" : "text-neutral-400")}>
                  {dropped ? "dropped" : s.kind}
                </span>
                <span className="ml-auto text-[11px] tabular-nums text-neutral-400">{time(s.at)}</span>
              </div>
              <p className={clsx("text-[12px] leading-snug", dropped ? "text-rose-300" : "text-neutral-900")}>{s.text}</p>
              {s.cypher && (
                <pre className="mt-1.5 overflow-x-auto rounded-[8px] bg-[#f4f6fa] p-2 font-mono text-[11px] leading-[1.6] text-neutral-800">
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
