import type { ReactNode } from "react";
import { Badge } from "@/components/outreach/bits";

export function Card({ n, title, sample, children }: { n?: number; title: string; sample?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col glass overflow-hidden rounded-[16px]">
      <div className="glass-band flex items-center gap-2 px-4 py-3">
        {n !== undefined && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 text-[11px] tabular-nums text-neutral-500">{n}</span>
        )}
        <h3 className="k-h3">{title}</h3>
        {sample && <Badge tone="warn">sample</Badge>}
      </div>
      <div className="flex flex-1 flex-col p-4">{children}</div>
    </section>
  );
}
