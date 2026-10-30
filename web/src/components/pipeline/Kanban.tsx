"use client";

import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import clsx from "clsx";
import { Bot, User } from "lucide-react";
import type { Company, Lead, Person, Stage } from "@/lib/types";
import { Badge, TierBadge, fmtTime } from "@/components/outreach/bits";

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
};

export function Kanban({ leads, people, companies, onMove }: Props) {
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
      <div className="grid grid-cols-5 gap-px overflow-x-auto border border-neutral-200 bg-neutral-200">
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            col={col}
            leads={leads.filter((l) => col.stages.includes(l.stage))}
            people={people}
            companies={companies}
            onMove={onMove}
          />
        ))}
      </div>
    </DndContext>
  );
}

function KanbanColumn({ col, leads, people, companies, onMove }: { col: Column } & Props) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <div ref={setNodeRef} className={clsx("flex min-h-[320px] min-w-[200px] flex-col bg-white", isOver && "bg-emerald-50/60")}>
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <span className="font-serif text-[14px] text-neutral-900">{col.label}</span>
        <span className="text-[12px] tabular-nums text-neutral-500">{leads.length}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        {leads.map((l) => (
          <LeadCard key={l.id} lead={l} person={people.get(l.person_id)} company={companies.get(l.company_id)} onMove={onMove} />
        ))}
      </div>
    </div>
  );
}

function LeadCard({ lead, person, company, onMove }: { lead: Lead; person?: Person; company?: Company; onMove: Props["onMove"] }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const closed = lead.stage === "closed_won" || lead.stage === "closed_lost";
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={clsx(
        "cursor-grab touch-none rounded-sm border border-neutral-200 bg-white px-2.5 py-2 text-[12px] active:cursor-grabbing",
        isDragging && "z-10 border-neutral-900 shadow-md",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-neutral-900">{person?.name ?? lead.person_id}</div>
          <div className="truncate text-neutral-500">{company?.name ?? lead.company_id}</div>
        </div>
        <span
          className={clsx(
            "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-px text-[10px] font-semibold",
            lead.owner === "ai" ? "bg-neutral-100 text-neutral-700" : "bg-neutral-900 text-white",
          )}
          title={lead.owner === "ai" ? "Last moved by an AI agent" : "Last moved by a rep"}
        >
          {lead.owner === "ai" ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
          {lead.owner === "ai" ? "AI" : "Rep"}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {company && <TierBadge tier={company.tier} />}
        {company && <Badge>{company.score}</Badge>}
        <Badge>Var {lead.variant}</Badge>
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
