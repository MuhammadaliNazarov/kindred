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
  { href: "/model", label: "Model · RL", hint: "Post-training" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-[rgba(7,13,34,0.55)] backdrop-blur-xl">
      <div className="flex h-16 items-center px-5">
        <Link href="/intake" aria-label="Kindred home" className="rounded-md">
          <Logo />
        </Link>
      </div>
      <ol className="flex flex-col gap-1 px-3 py-2">
        {STEPS.map((s, i) => {
          const active = path === s.href || path.startsWith(s.href + "/");
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                className={clsx(
                  "flex items-start gap-3 rounded-full px-3 py-2 transition-[background-color,color,box-shadow] duration-150",
                  active
                    ? "bg-accent/15 text-neutral-950 shadow-[inset_0_0_0_1px_rgba(111,141,255,0.45),0_0_24px_-6px_rgba(47,91,255,0.6)]"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
                )}
              >
                <span
                  className={clsx(
                    "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-mono tabular-nums",
                    active ? "border-transparent bg-accent text-white" : "border-neutral-300 text-neutral-500",
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex flex-col">
                  <span className="text-[14px] font-medium">{s.label}</span>
                  <span className="text-[12px] text-neutral-500">{s.hint}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="mt-auto border-t border-neutral-200 p-4 text-[12px] leading-relaxed text-neutral-500">
        Demo data is fictional. Sources marked <span className="rounded-full border border-neutral-300 px-1.5">sample</span> are placeholders.
      </div>
    </nav>
  );
}
