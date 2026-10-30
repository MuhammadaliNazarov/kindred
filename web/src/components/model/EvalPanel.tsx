"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { EvalMetric, ModelEval } from "@/lib/types";
import { getModelEval } from "@/lib/api";
import { Badge } from "@/components/outreach/bits";

const fmt = (v: number) => (Math.abs(v) <= 1 && !Number.isInteger(v) ? `${Math.round(v * 100)}%` : v.toFixed(2));

function MetricRow({ m, max }: { m: EvalMetric; max: number }) {
  const w = (v: number) => `${Math.max(1, Math.min(100, (v / max) * 100))}%`;
  const delta = m.trained === null ? null : m.trained - m.base;
  const isRate = m.base <= 1 && (m.trained ?? 0) <= 1;
  return (
    <div className="text-[12px]">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-neutral-800">{m.name}</span>
        {delta !== null && (
          <span className={clsx("tabular-nums font-medium", delta >= 0 ? "text-emerald-300" : "text-rose-300")}>
            {delta >= 0 ? "+" : "−"}
            {isRate ? `${Math.abs(Math.round(delta * 100))} pts` : Math.abs(delta).toFixed(2)}
          </span>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[11px] tracking-wider text-neutral-500">base</span>
          <div className="h-2.5 flex-1 bg-neutral-100"><div className="h-full bg-neutral-400" style={{ width: w(m.base) }} /></div>
          <span className="w-10 shrink-0 text-right tabular-nums text-neutral-600">{fmt(m.base)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[11px] tracking-wider text-neutral-500">trained</span>
          <div className="h-2.5 flex-1 bg-neutral-100">
            {m.trained !== null && <div className="h-full bg-emerald-600" style={{ width: w(m.trained) }} />}
          </div>
          <span className="w-10 shrink-0 text-right tabular-nums text-neutral-900">{m.trained === null ? "…" : fmt(m.trained)}</span>
        </div>
      </div>
    </div>
  );
}

export function EvalPanel() {
  const [ev, setEv] = useState<ModelEval | null>(null);
  useEffect(() => {
    let alive = true;
    getModelEval().then((e) => alive && setEv(e)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!ev) return <div className="h-40 animate-pulse border border-neutral-200 bg-neutral-50" />;

  const notRun = ev.status === "not_run" && (ev.metrics?.length ?? 0) === 0;
  const pending = !ev.model_trained || ev.status === "not_run" || ev.status === "running";
  const metrics = (ev.metrics ?? []).map((m) => ({ ...m, trained: pending ? null : m.trained ?? null }));

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-[20px] border border-neutral-200 bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <h3 className="font-serif text-[18px] text-neutral-900">Verifier metrics</h3>
          {ev.sample && <Badge tone="warn">sample</Badge>}
          {pending ? <Badge tone="warn">training in progress</Badge> : <Badge tone="ok">trained</Badge>}
          <span className="ml-auto text-[11px] tabular-nums text-neutral-500">
            {ev.model_base}
            {ev.model_trained && !pending ? ` vs ${ev.model_trained}` : ""} · n={ev.n}
          </span>
        </div>
        <div className="p-3">
          {notRun ? (
            <p className="text-[12px] text-neutral-500">Eval not run yet. Training runs on a Tenki CPU sandbox — not run yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {metrics.map((m) => (
                <MetricRow key={m.name} m={m} max={Math.max(1, m.base, m.trained ?? 0) * (m.base <= 1 ? 1 : 1.1)} />
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] text-neutral-500">
            <span className="mr-1 inline-block h-2 w-2 bg-neutral-400" />base
            <span className="ml-3 mr-1 inline-block h-2 w-2 bg-emerald-600" />trained · same held-out leads, same verifier.
          </p>
        </div>
      </section>

      {(ev.examples?.length ?? 0) > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {ev.examples.slice(0, 3).map((ex, i) => (
            <section key={`${ex.company}-${i}`} className="flex flex-col overflow-hidden rounded-[20px] border border-neutral-200 bg-surface">
              <div className="border-b border-neutral-200 px-3 py-2 font-serif text-[14px] text-neutral-900">{ex.company}</div>
              <div className="flex-1 space-y-3 p-3 text-[12px]">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] tracking-wider text-neutral-500">base</span>
                    <Badge>{ex.base_score}</Badge>
                  </div>
                  <p className="text-neutral-600">{ex.base_text}</p>
                </div>
                <div className="border-t border-neutral-100 pt-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] tracking-wider text-emerald-300">trained</span>
                    {!pending && ex.trained_score !== null && <Badge tone="ok">{ex.trained_score}</Badge>}
                  </div>
                  <p className="text-neutral-900">{pending || !ex.trained_text ? <span className="text-neutral-400">Training in progress…</span> : ex.trained_text}</p>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
