"use client";

import { Fragment, useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronRight, ChevronDown, Zap } from "lucide-react";
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
  creditsBlocked: boolean;
  showDropped: boolean;
};

const COLS = 8;

export function AccountsGrid(props: AccountsGridProps) {
  const { companies, peopleByCompany, selectedCompanyId, selectedPersonId, onSelectCompany, onSelectPerson, onEnrich, creditsBlocked, showDropped } =
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
                className="text-neutral-400 hover:text-neutral-900"
              >
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
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
            <div className="truncate">{row.original.industry}</div>
            <div className="font-mono text-[11px] text-neutral-500">{row.original.naics}</div>
          </div>
        ),
      }),
      col.display({
        id: "headcount",
        header: "Headcount",
        cell: ({ row }) => <span className="tabular-nums">{row.original.headcount.toLocaleString()}</span>,
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
          return <SourceChips sources={all} showDropped={showDropped} />;
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

  const widths = ["w-[200px]", "w-[150px]", "w-[80px]", "w-[110px]", "w-[150px]", "", "w-[90px]", "w-[130px]"];

  return (
    <table className="w-full table-fixed border-collapse text-[12px]">
      <thead className="sticky top-0 z-10 bg-white">
        {table.getHeaderGroups().map((hg) => (
          <tr key={hg.id} className="border-b border-neutral-200">
            {hg.headers.map((h, i) => (
              <th
                key={h.id}
                className={clsx(
                  "px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500",
                  widths[i],
                )}
              >
                <table.FlexRender header={h} />
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => {
          const c = row.original;
          const open = !!expanded[c.id];
          const people = peopleByCompany[c.id] ?? [];
          return (
            <Fragment key={row.id}>
              <tr
                onClick={() => onSelectCompany(c)}
                className={clsx(
                  "cursor-pointer border-b border-neutral-200 align-middle hover:bg-neutral-50",
                  selectedCompanyId === c.id && !selectedPersonId && "bg-emerald-50/60 hover:bg-emerald-50",
                )}
              >
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="overflow-hidden px-2 py-1.5">
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
                      "cursor-pointer border-b border-neutral-100 bg-neutral-50/50 hover:bg-neutral-100/70",
                      selectedPersonId === p.id && "bg-emerald-50 hover:bg-emerald-50",
                    )}
                  >
                    <td colSpan={2} className="overflow-hidden py-1.5 pl-9 pr-2">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="truncate text-[11px] text-neutral-500">{p.title}</div>
                    </td>
                    <td className="px-2 py-1.5 text-[11px] text-neutral-600">{p.seniority}</td>
                    <td colSpan={3} className="overflow-hidden px-2 py-1.5">
                      <EnrichmentIndicator e={p.enrichment} />
                    </td>
                    <td colSpan={2} className="px-2 py-1.5 text-right">
                      <EnrichButton person={p} blocked={creditsBlocked} onEnrich={onEnrich} />
                    </td>
                  </tr>
                ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function EnrichButton({ person, blocked, onEnrich }: { person: Person; blocked: boolean; onEnrich: (p: Person) => void }) {
  const pending = person.enrichment.email_status === "pending";
  const btn = (
    <button
      type="button"
      disabled={blocked || pending}
      onClick={(e) => {
        e.stopPropagation();
        onEnrich(person);
      }}
      className={clsx(
        "inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-[11px] font-medium",
        blocked || pending
          ? "cursor-not-allowed border-neutral-200 text-neutral-400"
          : "border-neutral-300 text-neutral-800 hover:border-neutral-900",
      )}
    >
      <Zap className="h-3 w-3" />
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
