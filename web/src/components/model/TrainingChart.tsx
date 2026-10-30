"use client";

import { useEffect, useState } from "react";
import type { TrainPoint } from "@/lib/types";
import { getTrainLog } from "@/lib/api";
import { Badge } from "@/components/outreach/bits";

export function LineChart({ points, height = 180 }: { points: TrainPoint[]; height?: number }) {
  const W = 720, H = height, PL = 30, PR = 8, PT = 8, PB = 20;
  const maxStep = Math.max(1, ...points.map((p) => p.step));
  const minStep = Math.min(...points.map((p) => p.step));
  const rs = points.map((p) => p.reward);
  const lo = Math.min(0, ...rs), hi = Math.max(1, ...rs);
  const x = (s: number) => PL + ((s - minStep) / Math.max(1, maxStep - minStep)) * (W - PL - PR);
  const y = (v: number) => H - PB - ((v - lo) / (hi - lo)) * (H - PB - PT);
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} role="img" aria-label="Reward per GRPO step">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.08)" />
          <text x={PL - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#8d99b8">{v.toFixed(1)}</text>
        </g>
      ))}
      <text x={PL} y={H - 5} fontSize={9} fill="#8d99b8">step {minStep}</text>
      <text x={W - PR} y={H - 5} textAnchor="end" fontSize={9} fill="#8d99b8">step {maxStep}</text>
      <polyline fill="none" stroke="#34d399" strokeWidth={2} strokeLinejoin="round" points={points.map((p) => `${x(p.step)},${y(p.reward)}`).join(" ")} />
      {points.length <= 60 && points.map((p) => <circle key={p.step} cx={x(p.step)} cy={y(p.reward)} r={2} fill="#34d399" />)}
    </svg>
  );
}

export function TrainingChart() {
  const [log, setLog] = useState<{ points: TrainPoint[]; sample: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    getTrainLog().then((l) => alive && setLog(l)).catch(() => alive && setLog({ points: [], sample: false }));
    return () => {
      alive = false;
    };
  }, []);
  const pts = log?.points ?? [];
  const last = pts[pts.length - 1];
  return (
    <section className="overflow-hidden rounded-[20px] border border-neutral-200 bg-surface">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
        <h3 className="font-serif text-[18px] text-neutral-900">Reward per GRPO step</h3>
        {log?.sample && <Badge tone="warn">sample</Badge>}
        {last && <span className="ml-auto text-[11px] tabular-nums text-neutral-500">{pts.length} steps · latest {last.reward.toFixed(2)} · first {pts[0].reward.toFixed(2)}</span>}
      </div>
      <div className="p-3">
        {!log ? (
          <div className="h-[180px] animate-pulse bg-neutral-50" />
        ) : pts.length < 2 ? (
          <div className="flex h-[180px] items-center justify-center text-[12px] text-neutral-500">Training runs on a Tenki CPU sandbox — not run yet</div>
        ) : (
          <LineChart points={pts} />
        )}
      </div>
    </section>
  );
}
