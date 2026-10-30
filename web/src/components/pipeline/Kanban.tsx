"use client";

import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import clsx from "clsx";
import { Bot, User } from "lucide-react";
import type { Company, Lead, Person, Stage } from "@/lib/types";
import { Badge, Skeleton, TierBadge, fmtTime } from "@/components/outreach/bits";

export type Column = { id: "matched" | "contacted" | "replied" | "meeting" | "closed"; label: string; stages: Stage[] };

export const COLUMNS: Column[] = [
  { id: "matched", label: "Matched", stages: ["matched"] },
  { id: "contacted", label: "Contacted", stages: ["contacted"] },
  { id: "replied", label: "Replied", stages: ["replied"] },
  { id: "meeting", label: "Meeting booked", stages: ["meeting"] },
  { id: "closed", label: "Closed / Lost", stages: ["closed_won", "closed_lost"] },
];

type Props = {
  leads: Lead[];
  people: Map<string, Person>;
  companies: Map<string, Company>;
  onMove: (lead: Lead, stage: Stage) => void;
  loading?: boolean;
};

export function Kanban({ leads, people, companies, onMove, loading }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function onDragEnd(e: DragEndEvent) {
    const lead = leads.find((l) => l.id === e.active.id);
    const col = COLUMNS.find((c) => c.id === e.over?.id);
    if (!lead || !col) return;
    if (col.stages.includes(lead.stage)) return;
    onMove(lead, col.stages[0]);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="overflow-x-auto">
        <div className="grid min-w-[860px] grid-cols-5 gap-px overflow-hidden rounded-[20px] border border-neutral-200 bg-neutral-200">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              col={col}
              leads={leads.filter((l) => col.stages.includes(l.stage))}
              people={people}
              companies={companies}
              onMove={onMove}
              loading={loading}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}

function KanbanColumn({ col, leads, people, companies, onMove, loading }: { col: Column } & Props) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <div
      ref={setNodeRef}
      className={clsx("flex min-h-[320px] min-w-0 flex-col bg-surface transition-colors duration-150", isOver && "bg-emerald-50/70")}
    >
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <span className="font-serif text-[14px] text-neutral-900">{col.label}</span>
        <span className="min-w-5 rounded-full bg-neutral-100 px-1.5 text-center text-[11px] tabular-nums text-neutral-600">{leads.length}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        {loading && leads.length === 0 && (
          <>
            <Skeleton className="h-[74px]" />
            <Skeleton className="h-[74px] opacity-60" />
          </>
        )}
        {!loading && leads.length === 0 && (
          <div
            className={clsx(
              "flex flex-1 items-center justify-center rounded-sm border border-dashed text-[11px] transition-colors",
              isOver ? "border-emerald-400 text-emerald-300" : "border-neutral-200 text-neutral-400",
            )}
          >
            {isOver ? "Release to move here" : "Drop a card here"}
          </div>
        )}
        {leads.map((l, i) => (
          <LeadCard key={l.id} index={i} lead={l} person={people.get(l.person_id)} company={companies.get(l.company_id)} onMove={onMove} />
        ))}
      </div>
    </div>
  );
}

function LeadCard({ lead, person, company, onMove, index }: { lead: Lead; person?: Person; company?: Company; onMove: Props["onMove"]; index: number }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = { ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}), "--i": index } as React.CSSProperties;
  const closed = lead.stage === "closed_won" || lead.stage === "closed_lost";
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={clsx(
        "wp-rise cursor-grab touch-none rounded-sm border border-neutral-200 bg-surface px-2.5 py-2 text-[12px] active:cursor-grabbing",
        "transition-[box-shadow,border-color] duration-150 hover:border-neutral-300 hover:shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_24px_-8px_rgba(0,0,0,0.5)]",
        isDragging && "z-10 rotate-[0.5deg] border-accent shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)]",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-neutral-900">{person?.name ?? lead.person_id}</div>
          <div className="truncate text-neutral-500">{company?.name ?? lead.company_id}</div>
        </div>
        <span
          className={clsx(
            "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-px text-[11px] font-medium",
            lead.owner === "ai" ? "bg-neutral-100 text-neutral-700" : "bg-accent text-white",
          )}
          title={lead.owner === "ai" ? "Last moved by an AI agent" : "Last moved by a rep"}
        >
          {lead.owner === "ai" ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
          {lead.owner === "ai" ? "AI" : "Rep"}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {company && <TierBadge tier={company.tier} />}
        {company && <Badge>{`${company.score}`}</Badge>}
        <Badge>{`Var ${lead.variant}`}</Badge>
        {closed && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onMove(lead, lead.stage === "closed_won" ? "closed_lost" : "closed_won")}
            title="Toggle won / lost"
          >
            <Badge tone={lead.stage === "closed_won" ? "ok" : "fail"}>{lead.stage === "closed_won" ? "Won" : "Lost"}</Badge>
          </button>
        )}
      </div>
      <div className="mt-1 text-[11px] tabular-nums text-neutral-400">{fmtTime(lead.updated_at)}</div>
    </div>
  );
}
