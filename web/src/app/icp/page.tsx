"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { buttonClass } from "@/components/ui/Button";
import { ArrowRight, Ban, Check, Pencil, X } from "lucide-react";
import type { ExpansionSegment, ICP, Source } from "@/lib/types";
import { getExpansions, getICP, setExpansionStatus } from "@/lib/api";
import { SourceChips } from "@/components/shell/SourceChip";

function ConfidenceBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  const tone = v >= 0.75 ? "bg-emerald-600" : v >= 0.55 ? "bg-amber-500" : "bg-rose-600";
  return (
    <span className="flex items-center gap-2" title={`Confidence ${v.toFixed(2)}`}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-neutral-200" aria-hidden>
        <span className={clsx("block h-full transition-[width] duration-700 ease-out", tone)} style={{ width: `${v * 100}%` }} />
      </span>
      <span className="w-8 text-right font-mono text-[11px] tabular-nums text-neutral-600">{v.toFixed(2)}</span>
    </span>
  );
}

function Row({ title, sub, confidence, sources }: { title: React.ReactNode; sub?: React.ReactNode; confidence: number; sources?: Source[] }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-neutral-100 py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-neutral-900">{title}</div>
        {sub && <div className="text-[12px] text-neutral-500">{sub}</div>}
      </div>
      <ConfidenceBar value={confidence} />
      <div className="col-span-2">
        <SourceChips sources={sources} />
      </div>
    </li>
  );
}

function Card({ title, count, children, className, index = 0 }: { title: string; count?: number; children: React.ReactNode; className?: string; index?: number }) {
  return (
    <section style={{ "--i": index * 2 } as React.CSSProperties} className={clsx("wp-rise glass overflow-hidden rounded-[16px]", className)}>
      <header className="glass-band flex items-baseline justify-between px-4 py-3">
        <h3 className="k-h3">{title}</h3>
        {count !== undefined && <span className="text-[12px] tabular-nums text-neutral-400">{count}</span>}
      </header>
      <div className="px-4">{children}</div>
    </section>
  );
}

const TRIGGER_LABEL: Record<string, string> = {
  funding: "Funding",
  exec_hire: "Exec hire",
  job_post: "Job post",
  tech_change: "Tech change",
  launch: "Launch",
};

export default function ICPPage() {
  const [icp, setIcp] = useState<ICP | null>(null);
  const [segs, setSegs] = useState<ExpansionSegment[]>([]);
  const [editing, setEditing] = useState<ExpansionSegment | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getICP()
      .then((i) => setIcp(i ?? null))
      .finally(() => setLoaded(true));
    getExpansions().then(setSegs);
  }, []);

  async function update(id: string, status: ExpansionSegment["status"], patch?: { name?: string; rationale?: string }) {
    // optimistic
    setSegs((s) => s.map((x) => (x.id === id ? { ...x, status, ...(patch ?? {}) } : x)));
    await setExpansionStatus(id, status, patch);
    setSegs(await getExpansions());
  }

  if (!icp && loaded)
    return (
      <div className="p-8 text-[13px] text-neutral-500">
        No ICP yet, run{" "}
        <Link href="/intake" className="text-neutral-900 underline">
          Intake
        </Link>
        .
      </div>
    );
  if (!icp)
    return (
      <div className="mx-auto max-w-6xl px-6 py-6" aria-busy>
        <div className="wp-skeleton mb-2 h-8 w-72" />
        <div className="wp-skeleton mb-6 h-3 w-96" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-neutral-200 p-4" style={{ opacity: 1 - i * 0.1 }}>
              <div className="wp-skeleton mb-4 h-4 w-1/3" />
              <div className="space-y-3">
                <div className="wp-skeleton h-3 w-5/6" />
                <div className="wp-skeleton h-3 w-2/3" />
                <div className="wp-skeleton h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );

  const allConf = [
    ...icp.industries.map((x) => x.confidence),
    icp.company_size.confidence,
    ...icp.personas.map((x) => x.confidence),
    ...icp.triggers.map((x) => x.confidence),
  ];
  const avg = allConf.reduce((a, b) => a + b, 0) / allConf.length;
  const size = icp.company_size.value;

  return (
    <div className="mx-auto max-w-6xl px-8 pb-12 pt-8">
      <div className="mb-8 flex items-end justify-between gap-8">
        <div>
          <h1 className="k-title">Ideal <span className="k-accent">customer</span> profile</h1>
          <p className="k-sub">
            Every field carries a confidence score and the sources it came from. Hover a source to see the quote.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="glass-chip flex h-10 items-center gap-2 rounded-full px-4">
            <span className="text-[12px] text-neutral-500">Mean confidence</span>
            <span className="font-mono text-[15px] font-medium tabular-nums text-neutral-950">{avg.toFixed(2)}</span>
          </div>
          <Link href="/discovery" className={buttonClass("primary")}>
            Find companies <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Industries" count={icp.industries.length} index={0}>
          <ul>
            {icp.industries.map((x) => (
              <Row
                key={x.value.naics + x.value.name}
                title={x.value.name}
                sub={<span className="font-mono tabular-nums">NAICS {x.value.naics}</span>}
                confidence={x.confidence}
                sources={x.sources}
              />
            ))}
          </ul>
        </Card>

        <Card title="Company size" index={1}>
          <ul>
            <Row
              title={
                <span className="tabular-nums">
                  {size.min_headcount}–{size.max_headcount} employees
                </span>
              }
              sub={size.revenue_band}
              confidence={icp.company_size.confidence}
              sources={icp.company_size.sources}
            />
          </ul>
          <div className="border-t border-neutral-100 py-2.5 text-[12px] text-neutral-500">
            Regions: <span className="text-neutral-800">{icp.regions.join(" · ")}</span>
          </div>
        </Card>

        <Card title="Personas" count={icp.personas.length} index={2}>
          <ul>
            {icp.personas.map((x) => (
              <Row
                key={x.value.title}
                title={x.value.title}
                sub={`${x.value.seniority} · ${x.value.function}`}
                confidence={x.confidence}
                sources={x.sources}
              />
            ))}
          </ul>
        </Card>

        <Card title="Triggers" count={icp.triggers.length} className="md:col-span-2" index={3}>
          <ul>
            {icp.triggers.map((x) => (
              <Row
                key={x.value.type + x.value.description}
                title={
                  <span className="flex items-center gap-2">
                    <span className="rounded border border-neutral-200 bg-neutral-50 px-1.5 text-[11px] tracking-wide text-neutral-600">
                      {TRIGGER_LABEL[x.value.type] ?? x.value.type}
                    </span>
                    {x.value.description}
                  </span>
                }
                confidence={x.confidence}
                sources={x.sources}
              />
            ))}
          </ul>
        </Card>

        <Card title="Negative signals" count={icp.negative_signals.length} index={4}>
          <ul className="py-1.5">
            {icp.negative_signals.map((n) => (
              <li key={n} className="flex items-start gap-2 py-1.5 text-[13px] text-neutral-800">
                <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />
                {n}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mb-3 mt-10 flex items-end justify-between">
        <div>
          <h2 className="text-[20px]">Expansion segments</h2>
          <p className="text-[12px] text-neutral-500">Adjacent markets the agents think could buy. Accept, adjust or dismiss each one.</p>
        </div>
        <span className="text-[11px] tabular-nums text-neutral-500">
          {segs.filter((s) => s.status === "accepted" || s.status === "adjusted").length} accepted ·{" "}
          {segs.filter((s) => s.status === "dismissed").length} dismissed
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {segs.map((s, i) => (
          <article
            key={s.id}
            style={{ "--i": 10 + i * 2 } as React.CSSProperties}
            className={clsx(
              "wp-rise glass-2 glass-card flex flex-col rounded-[16px] p-5",
              (s.status === "accepted" || s.status === "adjusted") &&
                "!shadow-[inset_0_0_0_1px_rgba(52,211,153,0.5),0_0_0_4px_rgba(52,211,153,0.10),0_16px_36px_-16px_rgba(16,24,40,0.18)]",
              s.status === "dismissed" && "opacity-50",
            )}
          >
            <div className="mb-1 flex items-start justify-between gap-3">
              <h3 className="k-h3">{s.name}</h3>
              <StatusTag status={s.status} />
            </div>
            <div className="mb-2">
              <ConfidenceBar value={s.confidence} />
            </div>
            <p className="mb-3 text-[13px] leading-relaxed text-neutral-700">{s.rationale}</p>
            <div className="k-label mb-1">Evidence</div>
            <ul className="mb-4 space-y-1.5">
              {s.sources.map((src, i) => (
                <li key={src.url + i} className="text-[12px] leading-snug">
                  <span className="font-serif italic text-neutral-700">“{src.quote}”</span>{" "}
                  <SourceChips sources={[src]} />
                </li>
              ))}
            </ul>
            <div className="mt-auto flex gap-2">
              <button
                onClick={() => update(s.id, "accepted")}
                className={clsx(
                  "flex h-9 flex-1 items-center justify-center gap-1 rounded-full text-[13px] font-medium",
                  s.status === "accepted" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-300 shadow-[inset_0_0_0_1px_#a7f3d0] hover:bg-emerald-100",
                )}
              >
                <Check className="h-3.5 w-3.5" /> Accept
              </button>
              <button
                onClick={() => setEditing(s)}
                className="flex h-9 flex-1 items-center justify-center gap-1 rounded-full bg-white text-[13px] text-neutral-900 shadow-[inset_0_0_0_1px_#e6e9f0] hover:bg-[#f3f5fa]"
              >
                <Pencil className="h-3.5 w-3.5" /> Adjust
              </button>
              <button
                onClick={() => update(s.id, s.status === "dismissed" ? "suggested" : "dismissed")}
                className="flex h-9 flex-1 items-center justify-center gap-1 rounded-full text-[13px] text-neutral-500 hover:bg-rose-50 hover:text-rose-300"
              >
                <X className="h-3.5 w-3.5" /> {s.status === "dismissed" ? "Restore" : "Dismiss"}
              </button>
            </div>
          </article>
        ))}
      </div>

      <AdjustDialog
        segment={editing}
        onClose={() => setEditing(null)}
        onSave={(name, rationale) => {
          if (editing) update(editing.id, "adjusted", { name, rationale });
          setEditing(null);
        }}
      />
    </div>
  );
}

function StatusTag({ status }: { status: ExpansionSegment["status"] }) {
  const tone: Record<ExpansionSegment["status"], string> = {
    suggested: "border-neutral-200 text-neutral-500",
    accepted: "border-emerald-300 bg-emerald-50 text-emerald-300",
    adjusted: "border-amber-300 bg-amber-50 text-amber-300",
    dismissed: "border-neutral-200 text-neutral-400",
  };
  return (
    <span key={status} className={clsx("wp-tick shrink-0 rounded border px-1.5 text-[11px] tracking-wide", tone[status])}>
      {status}
    </span>
  );
}

function AdjustDialog({
  segment,
  onClose,
  onSave,
}: {
  segment: ExpansionSegment | null;
  onClose: () => void;
  onSave: (name: string, rationale: string) => void;
}) {
  const [name, setName] = useState("");
  const [rationale, setRationale] = useState("");
  useEffect(() => {
    if (segment) {
      setName(segment.name);
      setRationale(segment.rationale);
    }
  }, [segment]);

  return (
    <Dialog.Root open={!!segment} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim fixed inset-0 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 glass-3 rounded-[16px] p-5">
          <Dialog.Title className="font-serif text-[20px] tracking-tight">Adjust segment</Dialog.Title>
          <Dialog.Description className="mb-4 text-[12px] text-neutral-500">
            Your edit is saved as “adjusted” and logged as a rep action.
          </Dialog.Description>
          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] tracking-wide text-neutral-500">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
            />
          </label>
          <label className="mb-5 block">
            <span className="mb-1 block text-[11px] tracking-wide text-neutral-500">Rationale</span>
            <textarea
              rows={4}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              className="w-full resize-none rounded-md border border-neutral-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Dialog.Close className="rounded-md border border-neutral-300 px-3 py-1.5 text-[13px] hover:bg-neutral-50">Cancel</Dialog.Close>
            <button
              disabled={!name.trim()}
              onClick={() => onSave(name.trim(), rationale.trim())}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              Save adjustment
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
