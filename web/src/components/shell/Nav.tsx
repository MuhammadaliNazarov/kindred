"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Logo } from "./Logo";

export const STEPS = [
  { href: "/intake", label: "Intake", hint: "Product and context" },
  { href: "/icp", label: "ICP", hint: "Who to sell to" },
  { href: "/discovery", label: "Discovery", hint: "Accounts and graph" },
  { href: "/outreach", label: "Outreach", hint: "Review queue" },
  { href: "/pipeline", label: "Pipeline", hint: "Kanban and analytics" },
  { href: "/model", label: "Learning", hint: "Model post-training" },
];

/** Row pitch of the nav list: h-12 item + gap-1. The active pill slides by this. */
const ROW = 52;

export function Nav() {
  const path = usePathname();
  const activeIndex = STEPS.findIndex((s) => path === s.href || path.startsWith(s.href + "/"));
  return (
    <nav aria-label="Workflow" className="nav-dark flex w-60 shrink-0 flex-col">
      <div className="flex h-16 items-center px-6">
        <Link href="/intake" aria-label="Kindred home" className="rounded-md">
          <Logo />
        </Link>
      </div>
      <div className="px-6 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#8d99b8]">Workflow</div>
      <ol className="relative flex flex-col gap-1 px-3">
        {activeIndex >= 0 && (
          <span
            aria-hidden
            className="nav-pill-indicator pointer-events-none absolute inset-x-3 top-0 h-12 rounded-full bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_0_0_1px_rgba(255,255,255,0.12)] backdrop-blur-md transition-transform duration-[220ms] ease-[cubic-bezier(0.77,0,0.175,1)]"
            style={{ transform: `translateY(${activeIndex * ROW}px)` }}
          >
            <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-[#9fd3ff]" />
          </span>
        )}
        {STEPS.map((s, i) => {
          const active = i === activeIndex;
          return (
            <li key={s.href} className="relative">
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex h-12 items-center gap-3 rounded-full px-3 transition-colors duration-150",
                  active ? "text-white" : "text-[#c9d3ec] hover:bg-white/5 hover:text-white",
                )}
              >
                <span
                  className={clsx(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] tabular-nums",
                    active ? "bg-accent text-white" : "border border-white/20 text-[#aab6d3]",
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className={clsx("text-[13px]", active ? "font-semibold" : "font-medium")}>{s.label}</span>
                  <span className="truncate text-[11px] text-[#aab6d3]">{s.hint}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="mt-auto p-6 text-[12px] leading-relaxed text-[#8d99b8]">
        Demo data is fictional. Sources marked <span className="rounded-full bg-white/10 px-1.5 text-[#c9d3ec]">sample</span> are placeholders.
      </div>
    </nav>
  );
}
