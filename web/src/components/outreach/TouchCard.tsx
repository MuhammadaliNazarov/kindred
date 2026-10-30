"use client";

import { useState } from "react";
import clsx from "clsx";
import { Check, Copy, ExternalLink, MessageSquareShare as Linkedin, Mail, Pencil, ShieldAlert, ShieldCheck, X, Zap } from "lucide-react";
import type { Signal, Touch } from "@/lib/types";
import { Badge, Btn, verdictTone } from "./bits";

type Props = {
  touch: Touch;
  signal?: Signal;
  busy?: boolean;
  index?: number;
  onApprove: (t: Touch) => void;
  onEdit: (t: Touch, body: { subject?: string; body: string }) => void;
  onReject: (t: Touch) => void;
};

const STATUS_TONE: Record<Touch["status"], "neutral" | "ok" | "warn" | "fail" | "dark"> = {
  draft: "neutral",
  approved: "ok",
  edited: "ok",
  rejected: "fail",
  sent: "dark",
};

export function TouchCard({ touch, signal, busy, index = 0, onApprove, onEdit, onReject }: Props) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(touch.subject ?? "");
  const [body, setBody] = useState(touch.body);
  const [copied, setCopied] = useState(false);

  const secFail = touch.security.verdict === "fail";
  const decided = touch.status !== "draft";
  const isLinkedIn = touch.channel === "linkedin";

  async function copy() {
    try {
      await navigator.clipboard.writeText(touch.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <article
      style={{ "--i": index } as React.CSSProperties}
      className={clsx(
        "wp-rise overflow-hidden rounded-[16px] border bg-white transition-[opacity,border-color,box-shadow] duration-300",
        decided ? "border-neutral-200 opacity-75" : "border-neutral-300 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)]",
        touch.status === "approved" || touch.status === "sent" ? "border-emerald-300" : "",
        touch.status === "rejected" ? "border-rose-200" : "",
      )}
    >
      {/* Pinned why-now signal */}
      <div className="flex items-start gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
        <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium tracking-wider text-neutral-500">Why now</div>
          {signal ? (
            <div className="text-[12px] text-neutral-800">
              {signal.summary} <span className="text-neutral-500 tabular-nums">· {signal.date}</span>
            </div>
          ) : (
            <div className="text-[12px] text-neutral-500">Signal {touch.signal_id}</div>
          )}
        </div>
        {signal?.source && (
          <a
            href={signal.source.url}
            target="_blank"
            rel="noreferrer"
            title={signal.source.quote}
            className={clsx(
              "inline-flex max-w-[260px] shrink-0 items-center gap-1 rounded-sm border px-1.5 py-px text-[11px] transition-colors",
              signal.source.verified
                ? "border-emerald-200 bg-emerald-50 text-emerald-300 hover:border-emerald-500"
                : "border-rose-200 bg-rose-50 text-rose-300 hover:border-rose-400",
            )}
          >
            {signal.source.verified ? <ShieldCheck className="h-3 w-3 shrink-0" /> : <ShieldAlert className="h-3 w-3 shrink-0" />}
            <span className="shrink-0 text-[11px] font-medium tracking-wide">{signal.source.verified ? "Proved" : "Unverified · dropped"}</span>
            <span className="truncate border-l border-white/15 pl-1.5">{signal.source.title || signal.source.url}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
          </a>
        )}
      </div>

      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-2.5">
        {isLinkedIn ? <Linkedin className="h-3.5 w-3.5 text-neutral-700" /> : <Mail className="h-3.5 w-3.5 text-neutral-700" />}
        <span className="text-[12px] font-medium text-neutral-900">
          Step {touch.step} · {isLinkedIn ? "LinkedIn" : "Email"}
        </span>
        <Badge>{`Variant ${touch.variant}`}</Badge>
        <span key={touch.status} className="wp-tick ml-auto">
          <Badge tone={STATUS_TONE[touch.status]}>{touch.status}</Badge>
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        {editing ? (
          <div className="space-y-1.5">
            {!isLinkedIn && (
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-sm border border-neutral-300 px-2 py-1 text-[13px] focus:border-accent focus:outline-none"
                placeholder="Subject"
              />
            )}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              className="w-full resize-y rounded-sm border border-neutral-300 px-2 py-1.5 text-[13px] leading-relaxed focus:border-accent focus:outline-none"
            />
          </div>
        ) : (
          <>
            {touch.subject && <div className="mb-1 text-[13px] font-medium text-neutral-900">{touch.subject}</div>}
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-800">{touch.body}</p>
          </>
        )}
      </div>

      {/* Verdicts */}
      <div className="grid grid-cols-2 gap-px border-t border-neutral-200 bg-neutral-200 text-[12px]">
        <div className="bg-[#fafbfd] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">Reviewer</span>
            <Badge tone={verdictTone(touch.review.verdict)}>{touch.review.verdict}</Badge>
            {touch.review.score !== undefined && (
              <span className="text-[11px] tabular-nums text-neutral-500" title="Verifier score = the GRPO reward">
                verifier {touch.review.score}/{touch.review.max_score ?? 4.5}
              </span>
            )}
            {touch.arm && <span className="text-[11px] text-neutral-400" title="Bandit arm (hook × CTA)">{touch.arm}</span>}
          </div>
          <div className="mt-0.5 text-neutral-600">{touch.review.notes}</div>
          {touch.review.checks && touch.review.checks.length > 0 && (
            <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
              {touch.review.checks.map((c) => (
                <li key={c.name} className={clsx("flex min-w-0 items-baseline gap-1 whitespace-nowrap", c.pass ? "text-emerald-300" : "text-rose-300", !c.pass && c.detail && "col-span-2 flex-wrap")} title={c.detail}>
                  <span aria-hidden>{c.pass ? "✓" : "✗"}</span>
                  <span className="sr-only">{c.pass ? "passed:" : "failed:"}</span>
                  <span className="truncate">{c.name}</span>
                  {!c.pass && c.detail && <span className="w-full truncate pl-3 text-neutral-500">{c.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-[#fafbfd] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">Security</span>
            <Badge tone={secFail ? "fail" : "ok"}>
              {secFail ? <ShieldAlert className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
              {touch.security.verdict}
            </Badge>
            <span className="text-[11px] text-neutral-400">links / PII</span>
          </div>
          <div className="mt-0.5 text-neutral-600">{touch.security.notes}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-200 px-3 py-2">
        {editing ? (
          <>
            <Btn
              variant="primary"
              disabled={busy}
              onClick={() => {
                onEdit(touch, { subject: isLinkedIn ? undefined : subject, body });
                setEditing(false);
              }}
            >
              <Check className="h-3.5 w-3.5" /> Save
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setBody(touch.body);
                setSubject(touch.subject ?? "");
              }}
            >
              Cancel
            </Btn>
          </>
        ) : (
          <>
            <Btn
              variant="primary"
              disabled={busy || secFail || decided}
              title={secFail ? "Blocked: Security check failed" : undefined}
              onClick={() => onApprove(touch)}
            >
              <Check className="h-3.5 w-3.5" /> Approve
            </Btn>
            <Btn disabled={busy || touch.status === "sent"} onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Btn>
            <Btn variant="danger" disabled={busy || decided} onClick={() => onReject(touch)}>
              <X className="h-3.5 w-3.5" /> Reject
            </Btn>
            {isLinkedIn && (
              <Btn variant="ghost" className="ml-auto" onClick={copy}>
                <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy to clipboard"}
              </Btn>
            )}
            {secFail && <span className="text-[11px] text-rose-300">Approve blocked by Security</span>}
          </>
        )}
      </div>
    </article>
  );
}
