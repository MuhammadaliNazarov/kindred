"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { Check, Loader2, X, AlertTriangle, Minus, ExternalLink, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { Company, Enrichment, Signal, Source } from "@/lib/types";

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          align="start"
          sideOffset={4}
          className="z-50 max-w-sm rounded border border-neutral-200 bg-panel p-2 text-[12px] leading-snug text-neutral-900 shadow-md"
        >
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function TierBadge({ tier }: { tier: Company["tier"] }) {
  return (
    <span
      className={clsx(
        "inline-flex h-[18px] w-[18px] items-center justify-center rounded-sm text-[11px] font-medium",
        tier === "A" && "bg-emerald-600 text-white",
        tier === "B" && "bg-amber-500 text-[#1a1300]",
        tier === "C" && "bg-neutral-200 text-neutral-700",
      )}
    >
      {tier}
    </span>
  );
}

export function ScoreCell({ c }: { c: Company }) {
  const fitPct = Math.max(0, Math.min(100, c.fit));
  const intentPct = Math.max(0, Math.min(100 - fitPct, c.intent));
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 text-right tabular-nums font-medium">{c.score}</span>
      <TierBadge tier={c.tier} />
      <Tip
        content={
          <span className="tabular-nums">
            Fit {c.fit}/60 · Intent {c.intent}/40
          </span>
        }
      >
        <div className="flex h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100">
          <div className="h-full bg-accent-hover" style={{ width: `${fitPct}%` }} />
          <div className="h-full bg-emerald-600" style={{ width: `${intentPct}%` }} />
        </div>
      </Tip>
    </div>
  );
}

const SIGNAL_LABEL: Record<Signal["type"], string> = {
  funding: "Funding",
  exec_hire: "Exec hire",
  job_post: "Job post",
  tech_change: "Tech change",
  launch: "Launch",
  churn_risk: "Churn risk",
};

export function SignalChip({ type }: { type: Signal["type"] }) {
  return (
    <span
      className={clsx(
        "shrink-0 rounded-sm border px-1 py-px text-[11px] font-medium tracking-wide",
        type === "churn_risk" ? "border-rose-200 text-rose-300" : "border-neutral-300 text-neutral-700",
      )}
    >
      {SIGNAL_LABEL[type]}
    </span>
  );
}

export function signalLabel(t: Signal["type"]) {
  return SIGNAL_LABEL[t];
}

export function latestSignal(c: Company): Signal | undefined {
  return [...c.signals].sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function fmtDate(d: string) {
  const t = Date.parse(d);
  if (Number.isNaN(t)) return d;
  return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function SignalCell({ s }: { s?: Signal }) {
  if (!s) return <span className="text-neutral-400">—</span>;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <SignalChip type={s.type} />
      <span className="truncate" title={s.summary}>
        {s.summary}
      </span>
      <span className="hidden shrink-0 tabular-nums text-neutral-500 @4xl:inline">{fmtDate(s.date)}</span>
    </div>
  );
}

export function SourceList({ sources }: { sources: Source[] }) {
  return (
    <ul className="space-y-2">
      {sources.map((s, i) => (
        <li key={i} className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <VerifiedTag verified={s.verified} />
            <span className={clsx("font-medium", !s.verified && "text-rose-300 line-through")}>{s.title}</span>
          </div>
          {s.quote && <p className="italic text-neutral-600">&ldquo;{s.quote}&rdquo;</p>}
          <a href={s.url} target="_blank" rel="noreferrer" className="block truncate text-emerald-300 underline">
            {s.url}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function VerifiedTag({ verified }: { verified: boolean }) {
  return (
    <span
      className={clsx(
        "rounded-sm px-1 text-[11px] font-medium",
        verified ? "bg-emerald-50 text-emerald-300" : "bg-rose-50 text-rose-300",
      )}
    >
      {verified ? "proved" : "dropped — quote not found"}
    </span>
  );
}

/** The crisp citation chip: Proved (opens the page) or Dropped (validator rejected the quote). */
export function CitationChip({
  verdict,
  count,
  href,
  label,
  compact,
}: {
  verdict: "proved" | "dropped";
  count?: number;
  href: string;
  label?: string;
  /** icon + count only (dense grid); the word lives in the title and the tooltip */
  compact?: boolean;
}) {
  const proved = verdict === "proved";
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={proved ? "Proved: quote found on the page. Opens the source." : "Dropped: quote not found on the page. Validator rejected it."}
      className={clsx(
        "group inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border pl-1 pr-1.5 text-[10.5px] font-medium tracking-wide tabular-nums transition-colors",
        proved
          ? "border-emerald-200 bg-emerald-50 text-emerald-300 hover:border-emerald-500 hover:bg-emerald-100"
          : "border-rose-200 bg-rose-50 text-rose-300 hover:border-rose-400",
      )}
    >
      {proved ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
      {!compact && <span className={clsx(!proved && "line-through decoration-rose-400")}>{label ?? (proved ? "Proved" : "Dropped")}</span>}
      {count !== undefined && <span className={clsx("rounded-[2px] px-1 font-mono text-[11px]", proved ? "bg-emerald-600 text-white" : "bg-rose-600 text-white")}>{count}</span>}
      <ExternalLink className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-70" />
    </a>
  );
}

/**
 * Citation chips. Verified sources open in a new tab. Unverified ones were rejected by the
 * validator (quote not found on the page) and are hidden unless showDropped is on.
 */
export function SourceChips({ sources, showDropped, compact }: { sources: Source[]; showDropped: boolean; compact?: boolean }) {
  const verified = sources.filter((s) => s.verified);
  const dropped = sources.filter((s) => !s.verified);
  const shown = showDropped ? sources : verified;
  if (!shown.length) {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-medium tracking-wide text-rose-300">
        <ShieldAlert className="h-3 w-3" />
        {dropped.length ? (compact ? `${dropped.length}` : `${dropped.length} dropped`) : "no source"}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {verified.length > 0 && (
        <Tip content={<SourceList sources={verified} />}>
          <span>
            <CitationChip verdict="proved" count={verified.length} href={verified[0].url} compact={compact} />
          </span>
        </Tip>
      )}
      {showDropped && dropped.length > 0 && (
        <Tip content={<SourceList sources={dropped} />}>
          <span>
            <CitationChip verdict="dropped" count={dropped.length} href={dropped[0].url} compact={compact} />
          </span>
        </Tip>
      )}
    </div>
  );
}

export function EmailStatus({ status }: { status: Enrichment["email_status"] }) {
  switch (status) {
    case "valid":
      return (
        <span className="inline-flex items-center gap-0.5 text-emerald-300">
          <Check className="h-3.5 w-3.5" /> valid
        </span>
      );
    case "accept_all":
      return (
        <span className="inline-flex items-center gap-0.5 text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" /> accept-all
        </span>
      );
    case "invalid":
      return (
        <span className="inline-flex items-center gap-0.5 text-rose-300">
          <X className="h-3.5 w-3.5" /> invalid
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center gap-0.5 text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> checking
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-0.5 text-neutral-400">
          <Minus className="h-3.5 w-3.5" /> unknown
        </span>
      );
  }
}

function InBadge({ muted }: { muted?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex h-3.5 w-3.5 items-center justify-center rounded-[2px] text-[11px] font-medium leading-none",
        muted ? "bg-neutral-100 text-neutral-300" : "bg-accent-hover text-white",
      )}
    >
      in
    </span>
  );
}

export function EnrichmentIndicator({ e }: { e: Enrichment }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 tabular-nums">
      <EmailStatus status={e.email_status} />
      {e.email && <span className="min-w-0 max-w-[180px] truncate font-mono text-[11px] text-neutral-600">{e.email}</span>}
      <span
        className={clsx(
          "text-[11px]",
          e.mx_ok === true && "text-emerald-300",
          e.mx_ok === false && "text-rose-300",
          e.mx_ok === null && "text-neutral-400",
        )}
      >
        MX {e.mx_ok === true ? "ok" : e.mx_ok === false ? "fail" : "—"}
      </span>
      {e.linkedin_url ? (
        <a
          href={e.linkedin_url}
          target="_blank"
          rel="noreferrer"
          onClick={(ev) => ev.stopPropagation()}
          className="text-neutral-600 hover:text-neutral-900"
          aria-label="LinkedIn profile"
        >
          <InBadge />
        </a>
      ) : (
        <InBadge muted />
      )}
      <span className="text-[11px] text-neutral-500">{e.provider ?? "—"}</span>
      <span className="text-[11px] text-neutral-700">{Math.round(e.confidence * 100)}%</span>
    </div>
  );
}
