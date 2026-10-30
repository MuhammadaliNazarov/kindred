"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export const STEPS = [
  { href: "/intake", label: "Intake", hint: "Product and context" },
  { href: "/icp", label: "ICP", hint: "Who to sell to" },
  { href: "/discovery", label: "Discovery", hint: "Accounts and graph" },
  { href: "/outreach", label: "Outreach", hint: "Review queue" },
  { href: "/pipeline", label: "Pipeline", hint: "Kanban and analytics" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex w-52 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="flex h-12 items-center border-b border-neutral-200 px-4">
        <Link href="/intake" className="font-serif text-[19px] tracking-tight">
          Warmpath
        </Link>
      </div>
      <ol className="flex flex-col gap-px p-2">
        {STEPS.map((s, i) => {
          const active = path === s.href || path.startsWith(s.href + "/");
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                className={clsx(
                  "flex items-start gap-3 rounded-md px-2.5 py-2 transition-colors",
                  active ? "bg-neutral-100 text-neutral-900" : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900",
                )}
              >
                <span
                  className={clsx(
                    "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums",
                    active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-500",
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex flex-col">
                  <span className="text-[13px] font-medium">{s.label}</span>
                  <span className="text-[11px] text-neutral-500">{s.hint}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="mt-auto border-t border-neutral-200 p-4 text-[11px] leading-relaxed text-neutral-500">
        Demo data is fictional. Sources marked <span className="rounded border border-neutral-300 px-1">sample</span> are placeholders.
      </div>
    </nav>
  );
}
