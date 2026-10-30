"use client";

import { buttonClass } from "@/components/ui/Button";
import { useEffect, useState } from "react";
import clsx from "clsx";
import type { BanditState } from "@/lib/types";
import { getBandit, resetBanditSim, simulateBandit } from "@/lib/api";
import { useThinking } from "@/components/shell/context";
import { Badge, uid } from "@/components/outreach/bits";

const COLORS: Record<string, string> = {
  signal_hook__call: "#2f5bff",
  signal_hook__doc: "#0ea5e9",
  warmintro_hook__call: "#f59e0b",
  warmintro_hook__doc: "#10b981",
};
const label = (id: string) => id.replace("_hook__", " hook · ").replace("warmintro", "warm intro").replace(/call$/, "call CTA").replace(/doc$/, "doc CTA");
const pct = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 w-full bg-neutral-100">
      <div className="h-full transition-[width] duration-500" style={{ width: `${Math.min(100, value * 100)}%`, background: color }} />
    </div>
  );
}

function ShareChart({ data }: { data: BanditState }) {
  const W = 360, H = 140, P = 22;
  const h = data.history;
  if (h.length < 2) return <div className="flex h-[140px] items-center justify-center text-[12px] text-neutral-400">No history yet: simulate sends or wait for replies.</div>;
  const maxStep = Math.max(1, h[h.length - 1].step);
  const x = (s: number) => P + (s / maxStep) * (W - P - 6);
  const y = (v: number) => H - P - v * (H - P - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[140px] w-full" role="img" aria-label="Traffic share per arm over sends">
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line x1={P} x2={W - 6} y1={y(v)} y2={y(v)} stroke="#eef1f6" strokeWidth={1} />
          <text x={P - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#5b6683">{v * 100}%</text>
        </g>
      ))}
      <text x={W - 6} y={H - 6} textAnchor="end" fontSize={9} fill="#5b6683">{maxStep} sends</text>
      <text x={P} y={H - 6} fontSize={9} fill="#5b6683">0</text>
      {data.arms.map((a) => (
        <polyline
          key={a.id}
          fill="none"
          stroke={COLORS[a.id] ?? "#5b6683"}
          strokeWidth={2}
          strokeLinejoin="round"
          points={h.map((p) => `${x(p.step)},${y(p.shares[a.id] ?? 0)}`).join(" ")}
        />
      ))}
    </svg>
  );
}

export function LearningLoop() {
  const { push } = useThinking();
  const [data, setData] = useState<BanditState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBandit().then(setData).catch(() => {});
  }, []);

  const leader = data ? [...data.arms].sort((a, b) => b.share - a.share)[0] : null;

  async function simulate() {
    setBusy(true);
    try {
      const d = await simulateBandit(300);
      setData(d);
      const top = [...d.arms].sort((a, b) => b.share - a.share)[0];
      // With a live API the backend emits this step over SSE; only push locally in seed mode.
      if (!process.env.NEXT_PUBLIC_API_URL) push({
        id: uid("th"),
        at: new Date().toISOString(),
        agent: "planner",
        kind: "reason",
        text: `Bandit (SIMULATED, 300 sends): shifting traffic to ${top.id} (p=${top.mean.toFixed(2)}, share ${pct(top.share)})`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      setData(await resetBanditSim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass overflow-hidden rounded-[16px]">
      <div className="glass-band flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="whitespace-nowrap font-serif text-[18px] text-neutral-900">Learning loop</h3>
          <span className="hidden text-[11px] text-neutral-500 md:inline">Thompson sampling over hook × CTA · reward = reply</span>
          {data?.simulated && <Badge tone="warn">SIMULATED</Badge>}
          {data && !data.simulated && <Badge tone="ok">real replies</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {data?.simulated && (
            <button onClick={reset} disabled={busy} className={buttonClass("ghost")}>
              Show real
            </button>
          )}
          <button
            onClick={simulate}
            disabled={busy}
            className={buttonClass("secondary")}
          >
            <span className="whitespace-nowrap">{busy ? "Simulating…" : "Simulate 300 sends"}</span>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 p-3 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="mb-1 grid grid-cols-[minmax(0,1fr)_44px_52px_48px] gap-2 text-[11px] font-medium tracking-wider text-neutral-500">
            <span>Arm</span>
            <span className="text-right">Traffic</span>
            <span className="text-right">Replies</span>
            <span className="text-right">Beta mean</span>
          </div>
          <div className="space-y-2">
            {(data?.arms ?? []).map((a) => (
              <div key={a.id} className={clsx("text-[12px]", leader?.id === a.id && "font-medium")}>
                <div className="grid grid-cols-[minmax(0,1fr)_44px_52px_48px] items-baseline gap-2 tabular-nums">
                  <span className="flex items-center gap-1.5 truncate text-neutral-800" title={`${a.hook_text ?? a.hook} · ${a.cta_text ?? a.cta}`}>
                    <span className="inline-block h-2 w-2 shrink-0" style={{ background: COLORS[a.id] }} />
                    {label(a.id)}
                  </span>
                  <span className="text-right">{pct(a.share)}</span>
                  <span className="text-right text-neutral-600">{a.replies}/{a.sent}</span>
                  <span className="text-right">{a.mean.toFixed(3)}</span>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  <Bar value={a.share} color={COLORS[a.id]} />
                  <Bar value={a.sent ? a.replies / a.sent / 0.2 : 0} color={COLORS[a.id]} />
                  <Bar value={a.mean / 0.6} color={COLORS[a.id]} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">
            Bars: traffic share · reply rate · Beta(replies+1, misses+1) mean.{" "}
            {leader && <>Traffic is shifting to <span className="font-medium text-neutral-800">{leader.id}</span>.</>}
          </p>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium tracking-wider text-neutral-500">Traffic share over sends</div>
          {data && <ShareChart data={data} />}
          {data?.simulated && <p className="mt-1 text-[11px] text-amber-300">Simulated replies for the demo; real stats update from reply webhooks and pipeline moves.</p>}
        </div>
      </div>
    </section>
  );
}
