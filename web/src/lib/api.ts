// Client for the Warmpath API. Every call tries the real API (NEXT_PUBLIC_API_URL) and falls back to an
// in-memory copy of the seed, so the UI works with no backend. Mutations update the in-memory copy.
import type {
  Actor,
  AuditEvent,
  Company,
  Credits,
  ExpansionSegment,
  GraphData,
  ICP,
  Intake,
  Lead,
  Person,
  Stage,
  ThinkingStep,
  Touch,
  WarmPath,
} from "./types";
import {
  seedAudit,
  seedCompanies,
  seedCredits,
  seedExpansions,
  seedGraph,
  seedICP,
  seedIntake,
  seedLeads,
  seedPeople,
  seedThinking,
  seedTouches,
  seedWarmPaths,
} from "./seed";

const API = process.env.NEXT_PUBLIC_API_URL;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// In-memory store (mutable copy of the seed).
const db = {
  intake: clone(seedIntake) as Intake,
  icp: clone(seedICP) as ICP,
  expansions: clone(seedExpansions) as ExpansionSegment[],
  companies: clone(seedCompanies) as Company[],
  people: clone(seedPeople) as Person[],
  leads: clone(seedLeads) as Lead[],
  touches: clone(seedTouches) as Touch[],
  audit: clone(seedAudit) as AuditEvent[],
  credits: clone(seedCredits) as Credits,
  graph: clone(seedGraph) as GraphData,
  warm: clone(seedWarmPaths) as WarmPath[],
};

async function call<T>(path: string, fallback: () => T, init?: RequestInit): Promise<T> {
  if (!API) return clone(fallback());
  try {
    const res = await fetch(API + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as T;
  } catch {
    return clone(fallback());
  }
}

const post = (body?: unknown): RequestInit => ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

let auditSeq = 1000;
function audit(e: Omit<AuditEvent, "id" | "at">) {
  db.audit.unshift({ id: `a${++auditSeq}`, at: new Date().toISOString(), ...e });
}

function spend(kind: keyof Credits["used"], n = 1) {
  const c = db.credits;
  c.used[kind] += n;
  c.balance = Math.max(0, c.balance - n);
  c.blocked = c.balance <= 0;
}

// ---------- Intake / ICP ----------
export function postIntake(intake: Intake): Promise<ICP> {
  return call<ICP>("/intake", () => {
    db.intake = clone(intake);
    audit({ actor: "rep", action: "intake.submitted", detail: `Intake for ${intake.product_name}` });
    audit({ actor: "ai", agent: "icp", action: "icp.generated", detail: "ICP regenerated from intake" });
    return db.icp;
  }, post(intake)).then((r) => {
    // The API returns {icp, expansions}; the seed path returns the ICP itself.
    const res = r as unknown as { icp?: ICP; expansions?: ExpansionSegment[] };
    if (res && res.icp) {
      db.icp = res.icp;
      if (res.expansions) db.expansions = res.expansions;
      return res.icp;
    }
    return r;
  });
}

export const getICP = () => call<ICP>("/icp", () => db.icp);

export const getExpansions = () => call<ExpansionSegment[]>("/expansions", () => db.expansions);

export function setExpansionStatus(
  id: string,
  status: ExpansionSegment["status"],
  patch?: { name?: string; rationale?: string },
): Promise<ExpansionSegment | null> {
  // Always mirror locally so the UI reacts even if the API echoes nothing useful.
  const local = () => {
    const seg = db.expansions.find((s) => s.id === id);
    if (!seg) return null;
    seg.status = status;
    if (patch?.name) seg.name = patch.name;
    if (patch?.rationale) seg.rationale = patch.rationale;
    audit({ actor: "rep", action: `expansion.${status}`, detail: seg.name });
    return seg;
  };
  return call<ExpansionSegment | null>(`/expansions/${id}`, local, post({ status, ...patch }));
}

// ---------- Accounts / buyers ----------
export const getCompanies = () => call<Company[]>("/companies", () => db.companies);
export const getPeople = () => call<Person[]>("/people", () => db.people);

export function getGraph(leadId?: string): Promise<GraphData> {
  const path = leadId ? `/graph?lead=${encodeURIComponent(leadId)}` : "/graph";
  return call<GraphData>(path, () => {
    if (!leadId) return db.graph;
    const lead = db.leads.find((l) => l.id === leadId);
    if (!lead) return db.graph;
    const keep = new Set<string>(["me", "tenki", lead.person_id, lead.company_id]);
    const wp = db.warm.find((w) => w.lead_id === leadId);
    wp?.hops.forEach((h) => (keep.add(h.from), keep.add(h.to)));
    // one ring around the company (colleagues, competitors, signals)
    db.graph.links.forEach((l) => {
      if (l.source === lead.company_id || l.target === lead.company_id) (keep.add(l.source), keep.add(l.target));
    });
    db.graph.links.forEach((l) => {
      if (l.source === "tenki" && keep.has(l.target)) keep.add(l.target);
    });
    const links = db.graph.links.filter((l) => keep.has(l.source) && keep.has(l.target));
    if (wp) {
      wp.hops.forEach((h) => {
        if (!links.some((l) => (l.source === h.from && l.target === h.to) || (l.source === h.to && l.target === h.from)))
          links.push({ source: h.from, target: h.to, rel: h.rel });
      });
    }
    return { nodes: db.graph.nodes.filter((n) => keep.has(n.id)), links };
  });
}

export function getWarmPath(leadId: string): Promise<WarmPath | null> {
  return call<WarmPath | null>(`/warm-path/${encodeURIComponent(leadId)}`, () => db.warm.find((w) => w.lead_id === leadId) ?? null);
}

// ---------- Pipeline ----------
export const getLeads = () => call<Lead[]>("/leads", () => db.leads);

export function moveLead(id: string, stage: Stage, actor: Actor): Promise<Lead | null> {
  const local = () => {
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) return null;
    const from = lead.stage;
    lead.stage = stage;
    lead.owner = actor;
    lead.updated_at = new Date().toISOString();
    audit({ actor, action: "lead.moved", lead_id: id, detail: `${from} → ${stage}` });
    return lead;
  };
  return call<Lead | null>(`/leads/${id}/move`, local, post({ stage, actor }));
}

// ---------- Enrichment (Flexprice-gated) ----------
export type EnrichResult = { ok: true; person: Person } | { ok: false; blocked: true; detail: string };

export async function enrichLead(personId: string): Promise<EnrichResult> {
  const lead = db.leads.find((l) => l.person_id === personId);
  const local = (): EnrichResult => {
    const p = db.people.find((x) => x.id === personId);
    if (!p) return { ok: false, blocked: true, detail: "unknown person" };
    if (db.credits.blocked || db.credits.balance < 1) {
      db.credits.blocked = true;
      return { ok: false, blocked: true, detail: "Enrichment paused — out of credits" };
    }
    spend("lead_enriched", 1);
    p.enrichment = { ...p.enrichment, email_status: "valid", mx_ok: true, provider: p.enrichment.provider ?? "hunter",
      confidence: Math.max(p.enrichment.confidence, 0.92) };
    audit({ actor: "ai", agent: "enricher", action: "lead.enriched", lead_id: lead?.id, detail: `${p.name}: email valid, MX ok` });
    return { ok: true, person: clone(p) };
  };
  if (!API) return local();
  try {
    const res = await fetch(`${API}/leads/${lead?.id ?? personId}/enrich`, { method: "POST" });
    if (res.status === 402) return { ok: false, blocked: true, detail: "Enrichment paused — out of credits" };
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    return { ok: true, person: (body.person ?? body) as Person };
  } catch {
    return local();
  }
}

// ---------- Outreach ----------
export const getTouches = () => call<Touch[]>("/touches", () => db.touches);

export function reviewTouch(id: string, action: "approve" | "edit" | "reject", body?: string): Promise<Touch | null> {
  const local = () => {
    const t = db.touches.find((x) => x.id === id);
    if (!t) return null;
    if (action === "approve") {
      t.status = "approved";
      spend("outreach_sent");
    } else if (action === "edit") {
      t.status = "edited";
      if (body !== undefined) t.body = body;
    } else t.status = "rejected";
    audit({ actor: "rep", action: `touch.${action === "approve" ? "approved" : action === "edit" ? "edited" : "rejected"}`, lead_id: t.lead_id, detail: `Touch ${t.step} (${t.channel}, variant ${t.variant})` });
    return t;
  };
  return call<Touch | null>(`/touches/${id}/review`, local, post({ action, body, actor: "rep" }));
}

export const getAudit = () => call<AuditEvent[]>("/audit", () => db.audit);
export const getCredits = () => call<Credits>("/credits", () => db.credits);

// ---------- Analytics ----------
export type FunnelRow = { matched: number; contacted: number; replied: number; meeting: number };
export type Analytics = {
  byStage: { stage: Stage; count: number }[];
  byIndustry: ({ industry: string } & FunnelRow)[];
  byTier: ({ tier: "A" | "B" | "C" } & FunnelRow)[];
  variants: { variant: "A" | "B"; sent: number; opened: number; replied: number }[];
};

const STAGES: Stage[] = ["matched", "contacted", "replied", "meeting", "closed_won", "closed_lost"];
// How far down the funnel a stage got. closed_lost counts as having replied.
const RANK: Record<Stage, number> = { matched: 0, contacted: 1, replied: 2, meeting: 3, closed_won: 4, closed_lost: 2 };

function computeAnalytics(): Analytics {
  const leads = db.leads;
  const co = (id: string) => db.companies.find((c) => c.id === id);
  const funnel = (ls: Lead[]): FunnelRow => ({
    matched: ls.length,
    contacted: ls.filter((l) => RANK[l.stage] >= 1).length,
    replied: ls.filter((l) => RANK[l.stage] >= 2).length,
    meeting: ls.filter((l) => RANK[l.stage] >= 3).length,
  });
  const industries = Array.from(new Set(leads.map((l) => co(l.company_id)?.industry ?? "Unknown")));
  return {
    byStage: STAGES.map((stage) => ({ stage, count: leads.filter((l) => l.stage === stage).length })),
    byIndustry: industries.map((industry) => ({ industry, ...funnel(leads.filter((l) => (co(l.company_id)?.industry ?? "Unknown") === industry)) })),
    byTier: (["A", "B", "C"] as const).map((tier) => ({ tier, ...funnel(leads.filter((l) => co(l.company_id)?.tier === tier)) })),
    variants: (["A", "B"] as const).map((variant) => {
      const f = funnel(leads.filter((l) => l.variant === variant));
      return { variant, sent: f.contacted, opened: Math.round(f.contacted * 0.75 + f.replied * 0.25), replied: f.replied };
    }),
  };
}

export const getAnalytics = () =>
  call<Analytics>("/analytics", computeAnalytics).then((a) => ({
    ...a,
    // API variants carry {sent, contacted, replied, reply_rate}; there is no open tracking, so use contacted as "opened".
    variants: a.variants.map((v) => {
      const x = v as typeof v & { contacted?: number };
      return { ...v, opened: v.opened ?? x.contacted ?? 0 };
    }),
  }));

// ---------- Agent Thinking stream ----------
export function streamThinking(onStep: (s: ThinkingStep) => void): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let es: EventSource | null = null;
  let stopped = false;

  const replay = () => {
    if (stopped || timer) return;
    let i = 0;
    timer = setInterval(() => {
      if (i >= seedThinking.length) {
        if (timer) clearInterval(timer);
        return;
      }
      const s = seedThinking[i++];
      onStep({ ...s, id: `${s.id}-${Date.now()}`, at: new Date().toISOString() });
    }, 1500);
  };

  if (API && typeof EventSource !== "undefined") {
    try {
      es = new EventSource(API + "/thinking/stream");
      let got = false;
      es.onmessage = (e) => {
        try {
          got = true;
          onStep(JSON.parse(e.data) as ThinkingStep);
        } catch {
          /* ignore malformed */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (!got) replay();
      };
    } catch {
      replay();
    }
  } else replay();

  return () => {
    stopped = true;
    es?.close();
    if (timer) clearInterval(timer);
  };
}
