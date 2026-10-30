"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Loader2, Play } from "lucide-react";
import type { Company, Enrichment, GraphData, Lead, Person, ThinkingStep, WarmPath } from "@/lib/types";
import { discover, enrichLead, getCompanies, getGraph, getLeads, getPeople, getWarmPath } from "@/lib/api";
import { useCredits, useThinking } from "@/components/shell/context";
import { AccountsGrid } from "@/components/discovery/AccountsGrid";
import { DEFAULT_FILTERS, Filters, applyFilters, type DiscoveryFilters } from "@/components/discovery/Filters";
import { GraphPane } from "@/components/discovery/GraphPane";

const step = (s: Omit<ThinkingStep, "id" | "at">): ThinkingStep => ({
  id: `ts_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
  at: new Date().toISOString(),
  ...s,
});

const WARM_PATH_CYPHER =
  "MATCH p = (me:Me)-[:previously_employed_at|works_at*1..3]-(buyer:Person)\nWHERE buyer.id = $person_id\nRETURN p ORDER BY length(p) LIMIT 1";

export default function DiscoveryPage() {
  const { push } = useThinking();
  const { credits, refresh } = useCredits();

  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DiscoveryFilters>(DEFAULT_FILTERS);
  const [enrichOverrides, setEnrichOverrides] = useState<Record<string, Enrichment>>({});
  const [enriching, setEnriching] = useState<Set<string>>(new Set());
  const [discovering, setDiscovering] = useState(false);

  const [selCompanyId, setSelCompanyId] = useState<string | null>(null);
  const [selPersonId, setSelPersonId] = useState<string | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [warmPath, setWarmPath] = useState<WarmPath | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  const reload = useCallback(
    (alive: () => boolean = () => true) =>
      Promise.all([getCompanies(), getPeople(), getLeads()])
        .then(([c, p, l]) => {
          if (!alive()) return;
          setCompanies([...c].sort((a, b) => b.score - a.score));
          setPeople(p);
          setLeads(l);
          setEnrichOverrides({});
        })
        .catch((e: unknown) => alive() && setError(e instanceof Error ? e.message : String(e))),
    [],
  );

  useEffect(() => {
    let alive = true;
    void reload(() => alive);
    return () => {
      alive = false;
    };
  }, [reload]);

  const onDiscover = async () => {
    setDiscovering(true);
    push(step({ agent: "planner", kind: "handoff", text: "Planner → Discovery: find accounts + job posts matching the ICP" }));
    try {
      await discover(); // the API's own thinking steps stream into the panel meanwhile
      await reload();
      push(step({ agent: "discovery", kind: "reason", text: "Discovery finished; accounts reloaded." }));
    } finally {
      setDiscovering(false);
    }
  };

  const peopleWithOverrides = useMemo(
    () => people.map((p) => (enrichOverrides[p.id] ? { ...p, enrichment: enrichOverrides[p.id] } : p)),
    [people, enrichOverrides],
  );

  const peopleByCompany = useMemo(() => {
    const m: Record<string, Person[]> = {};
    peopleWithOverrides.forEach((p) => (m[p.company_id] ??= []).push(p));
    return m;
  }, [peopleWithOverrides]);

  const industries = useMemo(
    () => Array.from(new Set((companies ?? []).map((c) => c.industry))).sort(),
    [companies],
  );
  const filtered = useMemo(() => applyFilters(companies ?? [], filters), [companies, filters]);

  const selCompany = useMemo(() => companies?.find((c) => c.id === selCompanyId) ?? null, [companies, selCompanyId]);
  const selPerson = useMemo(
    () => peopleWithOverrides.find((p) => p.id === selPersonId) ?? null,
    [peopleWithOverrides, selPersonId],
  );

  const loadLead = useCallback(
    async (leadId: string | undefined, label: string) => {
      setGraphLoading(true);
      push(step({ agent: "planner", kind: "graph", text: `Traversing warm paths… (${label})`, cypher: WARM_PATH_CYPHER }));
      try {
        const [g, wp] = await Promise.all([getGraph(leadId), leadId ? getWarmPath(leadId) : Promise.resolve(null)]);
        setGraph(g);
        setWarmPath(wp);
        if (wp?.cypher) push(step({ agent: "planner", kind: "graph", text: `Warm path found: ${wp.hops.length} hops`, cypher: wp.cypher }));
      } catch (e) {
        setGraph(null);
        setWarmPath(null);
        push(step({ agent: "planner", kind: "reason", text: `Graph query failed: ${e instanceof Error ? e.message : String(e)}` }));
      } finally {
        setGraphLoading(false);
      }
    },
    [push],
  );

  const onSelectCompany = (c: Company) => {
    setSelCompanyId(c.id);
    setSelPersonId(null);
    // Pick the company's lead (if any) so the warm path has a target.
    const lead = leads.find((l) => l.company_id === c.id);
    void loadLead(lead?.id, c.name);
  };

  const onSelectPerson = (p: Person) => {
    setSelCompanyId(p.company_id);
    setSelPersonId(p.id);
    const lead = leads.find((l) => l.person_id === p.id) ?? leads.find((l) => l.company_id === p.company_id);
    void loadLead(lead?.id, p.name);
  };

  const onEnrich = (p: Person) => {
    if (credits?.blocked) return;
    push(
      step({
        agent: "enricher",
        kind: "meter",
        text: `Enriching ${p.name} (${p.title}): Hunter → Apollo waterfall, MX check. Metered: lead_enriched −5 credits.`,
      }),
    );
    setEnriching((s) => new Set(s).add(p.id));
    const leadId = leads.find((l) => l.person_id === p.id)?.id;
    void enrichLead(p.id, leadId).then((r) => {
      setEnriching((s) => {
        const n = new Set(s);
        n.delete(p.id);
        return n;
      });
      if (r.ok) {
        setEnrichOverrides((o) => ({ ...o, [p.id]: r.person.enrichment }));
        push(step({ agent: "enricher", kind: "validate", text: `${p.name}: email ${r.person.enrichment.email_status}, MX ${r.person.enrichment.mx_ok ? "ok" : "?"} (${r.person.enrichment.provider}).` }));
      } else {
        setEnrichOverrides((o) => ({ ...o, [p.id]: p.enrichment }));
        push(step({ agent: "enricher", kind: "meter", text: `${r.detail} (Flexprice credit gate).` }));
      }
      void refresh();
    });
  };

  return (
    <Tooltip.Provider>
      <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900">
        <header className="flex items-baseline gap-3 px-4 pb-1 pt-4">
          <h1 className="font-serif text-[22px] leading-none">Discovery</h1>
          <span className="text-[12px] text-neutral-500">Accounts and buyers, every claim with its source.</span>
          <button
            type="button"
            onClick={() => void onDiscover()}
            disabled={discovering}
            className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-sm border border-neutral-300 px-2.5 text-[12px] font-medium text-neutral-800 hover:border-neutral-900 disabled:cursor-wait disabled:text-neutral-400"
          >
            {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {discovering ? "Discovering…" : "Run discovery"}
          </button>
        </header>

        <Filters
          value={filters}
          onChange={setFilters}
          industries={industries}
          count={filtered.length}
          total={companies?.length ?? 0}
        />

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto">
            {error ? (
              <div className="p-6 text-[12px] text-rose-600">Couldn&apos;t load accounts: {error}</div>
            ) : companies === null ? (
              <LoadingRows />
            ) : filtered.length === 0 ? (
              <div className="p-6 text-[12px] text-neutral-500">
                {companies.length === 0 ? "No accounts discovered yet. Run ICP first." : "No accounts match these filters."}
              </div>
            ) : (
              <AccountsGrid
                companies={filtered}
                peopleByCompany={peopleByCompany}
                selectedCompanyId={selCompanyId}
                selectedPersonId={selPersonId}
                onSelectCompany={onSelectCompany}
                onSelectPerson={onSelectPerson}
                onEnrich={onEnrich}
                enriching={enriching}
                creditsBlocked={!!credits?.blocked}
                showDropped={filters.showDropped}
              />
            )}
          </div>

          <aside className="w-[420px] shrink-0 overflow-hidden border-l border-neutral-200">
            <GraphPane loading={graphLoading} graph={graph} warmPath={warmPath} company={selCompany} person={selPerson} />
          </aside>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-px p-2">
      <div className="mb-2 flex items-center gap-2 px-2 text-[12px] text-neutral-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading accounts…
      </div>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-sm bg-neutral-50" />
      ))}
    </div>
  );
}
