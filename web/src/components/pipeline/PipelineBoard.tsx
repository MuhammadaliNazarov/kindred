"use client";

import { useEffect, useMemo, useState } from "react";
import type { AuditEvent, Company, Lead, Person, Stage } from "@/lib/types";
import { getAnalytics, getAudit, getCompanies, getLeads, getPeople, moveLead } from "@/lib/api";
import { useThinking } from "@/components/shell/context";
import { uid } from "@/components/outreach/bits";
import { Kanban } from "./Kanban";
import { Funnel, IndustryTable, TierTable, VariantTable, type AnalyticsData } from "./Analytics";
import { AuditLog } from "./AuditLog";
import { LearningLoop } from "./LearningLoop";

const EMPTY: AnalyticsData = { byStage: [], byIndustry: [], byTier: [], variants: [] };
const STAGES: Stage[] = ["matched", "contacted", "replied", "meeting", "closed_won", "closed_lost"];

export function PipelineBoard() {
  const { push } = useThinking();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData>(EMPTY);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([getLeads(), getPeople(), getCompanies(), getAnalytics(), getAudit()])
      .then(([l, p, c, a, au]) => {
        if (!alive) return;
        setLeads(l);
        setPeople(p);
        setCompanies(c);
        setAnalytics({ ...EMPTY, ...(a as AnalyticsData) });
        setAudit(au);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);

  // Funnel is computed from the live board so a drag updates it immediately.
  const byStage = useMemo(() => STAGES.map((s) => ({ stage: s, count: leads.filter((l) => l.stage === s).length })), [leads]);

  function leadLabel(id: string) {
    const l = leads.find((x) => x.id === id);
    if (!l) return id;
    return [personById.get(l.person_id)?.name, companyById.get(l.company_id)?.name].filter(Boolean).join(" · ") || id;
  }

  async function onMove(lead: Lead, stage: Stage) {
    const prev = lead.stage;
    const now = new Date().toISOString();
    setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, stage, owner: "rep", updated_at: now } : l)));
    try {
      const res = (await moveLead(lead.id, stage, "rep")) as unknown;
      if (res && typeof res === "object" && "id" in res && "stage" in res) {
        const updated = res as Lead;
        setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, ...updated } : l)));
      }
    } catch {
      /* keep optimistic move */
    }
    setAudit((a) => [
      { id: uid("au"), at: now, actor: "rep", action: "stage_moved", lead_id: lead.id, detail: `${prev} → ${stage}` },
      ...a,
    ]);
    push({
      id: uid("th"),
      at: now,
      agent: "planner",
      kind: "handoff",
      text: `Rep moved ${leadLabel(lead.id)} from ${prev} to ${stage}. Planner updates the next touch.`,
    });
    getAnalytics()
      .then((a) => setAnalytics((cur) => ({ ...cur, ...(a as AnalyticsData) })))
      .catch(() => {});
  }

  return (
    <div className="px-8 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="k-title">
            Your <span className="k-accent">pipeline</span>
          </h1>
          <p className="k-sub">
            {loading ? "Loading leads…" : `${leads.length} leads · drag a card to move it · every move shows who made it (AI or Rep)`}
          </p>
        </div>
      </div>

      <Kanban leads={leads} people={personById} companies={companyById} onMove={onMove} loading={loading} />

      <div className="mt-8">
        <LearningLoop />
      </div>

      <h2 className="mb-3 mt-10 text-[20px] font-semibold tracking-[-0.015em] text-neutral-950">Analytics</h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Funnel data={byStage} />
        <VariantTable rows={analytics.variants} />
        <IndustryTable rows={analytics.byIndustry} />
        <TierTable rows={analytics.byTier} />
      </div>

      <div className="mt-4">
        <AuditLog events={audit} leadLabel={leadLabel} />
      </div>
    </div>
  );
}
