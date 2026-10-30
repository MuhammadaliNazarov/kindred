"use client";

import clsx from "clsx";
import type { ReactNode } from "react";

export function uid(prefix = "x") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "ok" | "warn" | "fail" | "dark"; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-[11px] font-medium leading-4 tabular-nums",
        tone === "neutral" && "border-neutral-200 bg-neutral-50 text-neutral-700",
        tone === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "fail" && "border-rose-200 bg-rose-50 text-rose-700",
        tone === "dark" && "border-neutral-900 bg-neutral-900 text-white",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function TierBadge({ tier }: { tier: "A" | "B" | "C" | string }) {
  return <Badge tone={tier === "A" ? "dark" : "neutral"}>Tier {tier}</Badge>;
}

export function verdictTone(v: "pass" | "fix" | "fail"): "ok" | "warn" | "fail" {
  return v === "pass" ? "ok" : v === "fix" ? "warn" : "fail";
}

export function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function Btn({
  children,
  onClick,
  disabled,
  variant = "default",
  title,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger" | "ghost";
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variant === "default" && "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50",
        variant === "primary" && "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700",
        variant === "danger" && "border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
        variant === "ghost" && "border-transparent bg-transparent text-neutral-600 hover:bg-neutral-100",
        className,
      )}
    >
      {children}
    </button>
  );
}
