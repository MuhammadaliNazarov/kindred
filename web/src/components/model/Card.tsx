import type { ReactNode } from "react";
import { Badge } from "@/components/outreach/bits";

export function Card({ n, title, sample, children }: { n?: number; title: string; sample?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-[20px] border border-neutral-200 bg-surface">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
        {n !== undefined && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 text-[11px] tabular-nums text-neutral-500">{n}</span>
        )}
        <h3 className="font-serif text-[18px] text-neutral-900">{title}</h3>
        {sample && <Badge tone="warn">sample</Badge>}
      </div>
      <div className="flex flex-1 flex-col p-3">{children}</div>
    </section>
  );
}
