"use client";

import { useState } from "react";
import clsx from "clsx";
import type { Actor, AuditEvent } from "@/lib/types";
import { Badge, fmtTime } from "@/components/outreach/bits";

export function AuditLog({ events, leadLabel }: { events: AuditEvent[]; leadLabel: (id: string) => string }) {
  const [filter, setFilter] = useState<"all" | Actor>("all");
  const rows = events
    .filter((e) => filter === "all" || e.actor === filter)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const counts = { all: events.length, ai: events.filter((e) => e.actor === "ai").length, rep: events.filter((e) => e.actor === "rep").length };

  return (
    <section className="glass overflow-hidden rounded-[16px]">
      <div className="glass-band flex items-center justify-between px-4 py-2.5">
        <h3 className="font-serif text-[18px] text-neutral-900">Audit log</h3>
        <div className="flex border border-neutral-200 text-[11px]">
          {(["all", "ai", "rep"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={clsx("px-2 py-0.5 tabular-nums", filter === f ? "bg-accent text-white" : "text-neutral-600 hover:bg-neutral-50")}
            >
              {f === "all" ? "All" : f === "ai" ? "AI" : "Rep"} {counts[f]}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full text-[12px] tabular-nums">
          <thead className="sticky top-0 bg-panel">
            <tr className="text-left text-[12px] font-medium text-neutral-400">
              <th className="px-3 py-1 font-medium">Time</th>
              <th className="px-3 py-1 font-medium">Actor</th>
              <th className="px-3 py-1 font-medium">Action</th>
              <th className="px-3 py-1 font-medium">Lead</th>
              <th className="px-3 py-1 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-neutral-100 align-top">
                <td className="whitespace-nowrap px-3 py-1 text-neutral-500">{fmtTime(e.at)}</td>
                <td className="whitespace-nowrap px-3 py-1">
                  <Badge tone={e.actor === "rep" ? "dark" : "neutral"}>{e.actor === "rep" ? "Rep" : "AI"}</Badge>
                  {e.agent && <span className="ml-1 text-neutral-500">{e.agent}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-1 font-mono text-[11px] text-neutral-800">{e.action}</td>
                <td className="whitespace-nowrap px-3 py-1 text-neutral-800">{e.lead_id ? leadLabel(e.lead_id) : "—"}</td>
                <td className="px-3 py-1 text-neutral-600">{e.detail}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-2 text-neutral-400">
                  No events.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
