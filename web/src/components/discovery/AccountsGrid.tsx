"use client";

import { Fragment, useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronRight, Loader2, Zap } from "lucide-react";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import type { Company, Person } from "@/lib/types";
import { EnrichmentIndicator, ScoreCell, SignalCell, SourceChips, Tip, latestSignal } from "./cells";

const features = tableFeatures({});
const col = createColumnHelper<typeof features, Company>();

export type AccountsGridProps = {
  companies: Company[];
  peopleByCompany: Record<string, Person[]>;
  selectedCompanyId: string | null;
  selectedPersonId: string | null;
  onSelectCompany: (c: Company) => void;
  onSelectPerson: (p: Person) => void;
  onEnrich: (p: Person) => void;
  enriching: Set<string>;
  creditsBlocked: boolean;
  showDropped: boolean;
};

const COLS = 8;

export function AccountsGrid(props: AccountsGridProps) {
  const { companies, peopleByCompany, selectedCompanyId, selectedPersonId, onSelectCompany, onSelectPerson, onEnrich, enriching, creditsBlocked, showDropped } =
    props;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const columns = useMemo(
    () => [
      col.display({
        id: "company",
        header: "Company",
        cell: ({ row }) => {
          const c = row.original;
          const open = !!expanded[c.id];
          const n = peopleByCompany[c.id]?.length ?? 0;
          return (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={open ? "Collapse buyers" : "Expand buyers"}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((x) => ({ ...x, [c.id]: !x[c.id] }));
                }}
                className="no-press -ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900"
              >
                <ChevronRight className={clsx("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-90")} />
              </button>
              <div className="min-w-0">
                <div className="truncate font-medium">{c.name}</div>
                <div className="truncate text-[11px] text-neutral-500">
                  {c.domain}
                  {n > 0 && <span className="ml-1 tabular-nums">· {n} buyers</span>}
                </div>
              </div>
            </div>
          );
        },
      }),
      col.display({
        id: "industry",
        header: "Industry / NAICS",
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate">{row.original.industry.includes("no LLM") ? "AI / software" : row.original.industry}</div>
            <div className="font-mono text-[11px] text-neutral-500">{row.original.naics}</div>
          </div>
        ),
      }),
      col.display({
        id: "headcount",
        header: "Headcount",
        cell: ({ row }) => <span className="tabular-nums">{row.original.headcount == null ? <span className="text-neutral-400">unknown</span> : row.original.headcount.toLocaleString()}</span>,
      }),
      col.display({ id: "hq", header: "HQ", cell: ({ row }) => <span className="truncate">{row.original.hq}</span> }),
      col.display({ id: "score", header: "Score", cell: ({ row }) => <ScoreCell c={row.original} /> }),
      col.display({ id: "signal", header: "Latest signal", cell: ({ row }) => <SignalCell s={latestSignal(row.original)} /> }),
      col.display({
        id: "sources",
        header: "Sources",
        cell: ({ row }) => {
          const c = row.original;
          const all = [...c.sources, ...c.signals.map((s) => s.source)];
          return <SourceChips sources={all} showDropped={showDropped} compact />;
        },
      }),
      col.display({
        id: "competitors",
        header: "Competitors used",
        cell: ({ row }) =>
          row.original.competitors_used.length ? (
            <div className="flex flex-wrap gap-1">
              {row.original.competitors_used.map((x) => (
                <span key={x} className="rounded-sm bg-neutral-100 px-1 text-[11px] text-neutral-700">
                  {x}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-neutral-400">—</span>
          ),
      }),
    ],
    [expanded, peopleByCompany, showDropped],
  );

  const table = useTable({ features, columns, data: companies });

  // Width + visibility per column. The grid is a container (@container on the wrapper), so columns
  // drop out as the pane narrows (Thinking panel open, graph pane open) instead of the table clipping.
  const colCls = [
    "w-[190px]", // company
    "hidden w-[140px] @3xl:table-cell", // industry
    "hidden w-[80px] @5xl:table-cell", // headcount
    "hidden w-[100px] @4xl:table-cell", // hq
    "w-[140px]", // score
    "hidden @2xl:table-cell", // signal (flex); hidden when the pane is too narrow to show it
    "w-[92px]", // sources
    "hidden w-[120px] @6xl:table-cell", // competitors
  ];

  return (
    <div className="@container">
    <table className="w-full table-fixed border-collapse text-[12px]">
      <thead className="sticky top-0 z-10 bg-[#fafbfd] shadow-[0_1px_0_#e6e9f0]">
        {table.getHeaderGroups().map((hg) => (
          <tr key={hg.id} className="border-b border-neutral-200">
            {hg.headers.map((h, i) => (
              <th
                key={h.id}
                className={clsx(
                  "h-9 truncate whitespace-nowrap px-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-neutral-500",
                  colCls[i],
                )}
              >
                <table.FlexRender header={h} />
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row, i) => {
          const c = row.original;
          const open = !!expanded[c.id];
          const people = peopleByCompany[c.id] ?? [];
          const selected = selectedCompanyId === c.id && !selectedPersonId;
          return (
            <Fragment key={row.id}>
              <tr
                onClick={() => onSelectCompany(c)}
                style={{ "--i": Math.min(i, 14) } as React.CSSProperties}
                className={clsx(
                  "wp-rise cursor-pointer border-b border-neutral-200 align-middle transition-colors duration-100 hover:bg-neutral-50",
                  selected && "bg-[#eef2ff] shadow-[inset_2px_0_0_#2f5bff] hover:bg-[#eef2ff]",
                )}
              >
                {row.getAllCells().map((cell, ci) => (
                  <td key={cell.id} className={clsx("overflow-hidden px-2 py-1.5", colCls[ci])}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
              {open && people.length === 0 && (
                <tr className="border-b border-neutral-100 bg-neutral-50/50">
                  <td colSpan={COLS} className="py-1.5 pl-9 text-neutral-400">
                    No buyers found yet.
                  </td>
                </tr>
              )}
              {open &&
                people.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => onSelectPerson(p)}
                    className={clsx(
                      "wp-fade-in cursor-pointer border-b border-neutral-100 bg-neutral-50/50 transition-colors duration-100 hover:bg-neutral-100/70",
                      selectedPersonId === p.id && "bg-[#eef2ff] shadow-[inset_2px_0_0_#2f5bff] hover:bg-[#eef2ff]",
                    )}
                  >
                    <td colSpan={COLS} className="overflow-hidden py-1.5 pl-9 pr-2">
                      <div className="flex items-center gap-3">
                        <div className="w-[164px] min-w-0 shrink-0">
                          <div className="truncate font-medium">{p.name}</div>
                          <div className="truncate text-[11px] text-neutral-500">{p.title}</div>
                        </div>
                        <span className="hidden w-16 shrink-0 text-[11px] text-neutral-600 @3xl:inline">{p.seniority}</span>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <EnrichmentIndicator e={p.enrichment} />
                        </div>
                        <div className="shrink-0 text-right">
                          <EnrichButton person={p} pending={enriching.has(p.id)} blocked={creditsBlocked} onEnrich={onEnrich} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function EnrichButton({ person, pending, blocked, onEnrich }: { person: Person; pending: boolean; blocked: boolean; onEnrich: (p: Person) => void }) {
  // `pending` = request in flight. The API's email_status "pending" just means "not verified yet" and must stay clickable.
  const btn = (
    <button
      type="button"
      disabled={blocked || pending}
      onClick={(e) => {
        e.stopPropagation();
        onEnrich(person);
      }}
      className={clsx(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-[11px] font-medium",
        blocked
          ? "cursor-not-allowed border-rose-200 bg-rose-50 text-rose-400 line-through decoration-rose-300"
          : pending
            ? "cursor-wait border-neutral-200 text-neutral-400"
            : "border-neutral-300 text-neutral-800 hover:border-accent hover:bg-neutral-50",
      )}
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className={clsx("h-3 w-3", !blocked && "text-amber-300")} />}
      {pending ? "Verifying…" : "Verify & enrich"}
    </button>
  );
  if (!blocked) return btn;
  return (
    <Tip content={<span>Out of credits. Top up to enrich more leads.</span>}>
      {/* span wrapper so the tooltip fires on a disabled button */}
      <span tabIndex={0} className="inline-block">
        {btn}
      </span>
    </Tip>
  );
}
