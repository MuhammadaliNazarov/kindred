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
  BanditState,
  VerifyResult,
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
// Optional light guard; must match the API's DEMO_KEY when that is set.
const DEMO_KEY = process.env.NEXT_PUBLIC_DEMO_KEY;
const keyHeader: Record<string, string> = DEMO_KEY ? { "X-Demo-Key": DEMO_KEY } : {};

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
      headers: { "Content-Type": "application/json", ...keyHeader, ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(path === "/intake" ? 60000 : path === "/discover" ? 90000 : 8000),
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

export async function enrichLead(personId: string, leadId?: string): Promise<EnrichResult> {
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
    // Use the live lead id from loaded leads; the API also maps a bare person id to its lead.
    const res = await fetch(`${API}/leads/${encodeURIComponent(leadId ?? personId)}/enrich`, {
      method: "POST",
      headers: keyHeader,
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 402) return { ok: false, blocked: true, detail: "Enrichment paused — out of credits" };
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    return { ok: true, person: (body.person ?? body) as Person };
  } catch {
    return local();
  }
}

// ---------- Outreach ----------
export const getTouches = () => call<Touch[]>("/touches", () => db.touches.map(withVerifier));

export function reviewTouch(id: string, action: "approve" | "edit" | "reject", body?: string): Promise<Touch | null> {
  const local = () => {
    const t = db.touches.find((x) => x.id === id);
    if (!t) return null;
    if (action === "approve") {
      // Approve = human click → send (email only; LinkedIn stays a manual task).
      t.status = t.channel === "email" ? "sent" : "approved";
      if (t.channel === "email") {
        spend("outreach_sent");
        const lead = db.leads.find((l) => l.id === t.lead_id);
        if (lead?.stage === "matched") {
          lead.stage = "contacted";
          lead.owner = "ai";
          audit({ actor: "ai", agent: "builder", action: "lead.moved", lead_id: lead.id, detail: "matched → contacted (first touch sent)" });
        }
      }
    } else if (action === "edit") {
      t.status = "edited";
      if (body !== undefined) t.body = body;
    } else t.status = "rejected";
    audit({ actor: "rep", action: `touch.${action === "approve" ? "approved" : action === "edit" ? "edited" : "rejected"}`, lead_id: t.lead_id, detail: `Touch ${t.step} (${t.channel}, variant ${t.variant})` });
    return t;
  };
  return call<Touch | null>(`/touches/${id}/review`, local, post({ action, body, actor: "rep" }));
}

// Runs live discovery (or the seeded replay) on the API; returns its summary. Thinking steps stream meanwhile.
export const discover = () => call<Record<string, unknown> | null>("/discover", () => null, post());

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
      return { ...v, sent: Math.max(v.sent ?? 0, x.contacted ?? 0), opened: v.opened ?? x.contacted ?? 0 };
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
      // Stable id per session so a re-subscribed stream (StrictMode, remount) can't duplicate a step.
      onStep({ ...s, id: `seed-${s.id}`, at: new Date().toISOString() });
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

// ---------- Learning loop: verifier (same rules as api/app/verifier.py) ----------
const BANNED = /\b(guarantee[ds]?|guaranteed|100%|risk[- ]free|promise[ds]?|zero risk|never fail)\b/i;
const URL_RE = /https?:\/\/[^\s)>\]]+/gi;
const STOPW = new Set("the a an and or to of in on for at by with is are was were be this that it its your you we our i from as about".split(" "));
const CLAIM = /\d|raised|hiring|hired|launch|announc|post|migrat|series|seed|funding|joined|outage|pricing/i;
const wordsOf = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9$%]+/g) ?? []).filter((w) => !STOPW.has(w) && w.length > 2));

export function localVerify(text: string, company: string, signal: string, context = "", allowed: string[] = ["tenki.cloud"]): VerifyResult {
  const low = text.toLowerCase();
  const n = text.split(/\s+/).filter(Boolean).length;
  const sigW = Array.from(wordsOf(signal));
  const tw = wordsOf(text);
  const sigHit =
    signal.toLowerCase().split(/\s+/).slice(-3).some((w) => w.length > 2 && low.includes(w)) ||
    (sigW.length > 0 && sigW.filter((w) => tw.has(w)).length >= Math.max(1, Math.min(2, Math.floor(sigW.length / 3))));
  const lines = text.trim().split(/\n+/).filter((l) => l.trim());
  while (lines.length && (/^\s*(—|--|-|–|cheers|best|thanks)\b/i.test(lines[lines.length - 1]) || (lines[lines.length - 1].split(/\s+/).length <= 2 && !lines[lines.length - 1].trim().endsWith("?")))) lines.pop();
  const last = lines.join("\n").replace(URL_RE, "").trim();
  const ctx = wordsOf(`${context} ${signal} ${company}`);
  const unsupported = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x && CLAIM.test(x) && !x.endsWith("?"))
    .filter((x) => {
      const w = Array.from(wordsOf(x.replace(URL_RE, "")));
      return w.length > 0 && w.filter((y) => ctx.has(y)).length / w.length < 0.4;
    });
  const badLinks = (text.match(URL_RE) ?? [])
    .map((u) => { try { return new URL(u).host.replace("www.", ""); } catch { return u; } })
    .filter((h) => !allowed.some((d) => h === d || h.endsWith("." + d)));
  const checks = [
    { name: "company mentioned", pass: !!company && low.includes(company.toLowerCase()), w: 1, f: 0 },
    { name: "cites the signal", pass: sigHit, w: 1, f: 0 },
    { name: "ends with a question CTA", pass: last.endsWith("?"), w: 1, f: 0 },
    { name: `30–90 words (${n})`, pass: n >= 30 && n <= 90, w: 0.5, f: -0.5 },
    { name: "every claim has a source", pass: unsupported.length === 0, w: 1, f: 0, detail: unsupported.join(" | ") || undefined },
    { name: "no outcome guarantees", pass: !BANNED.test(text), w: 0, f: -2 },
    { name: "links only to allowed domains", pass: badLinks.length === 0, w: 0, f: -1, detail: badLinks.join(", ") || undefined },
  ];
  const score = checks.reduce((a, c) => a + (c.pass ? c.w : c.f), 0);
  return { score: Math.round(score * 100) / 100, max: 4.5, checks: checks.map(({ name, pass, detail }) => (detail ? { name, pass, detail } : { name, pass })) };
}

function withVerifier(t: Touch): Touch {
  if (t.review.checks) return t;
  const co = db.companies.find((c) => c.signals?.some((s) => s.id === t.signal_id));
  const sig = co?.signals.find((s) => s.id === t.signal_id);
  if (!co || !sig) return t;
  const v = localVerify(t.body, co.name, `${sig.summary} ${sig.type.replace("_", " ")}`, `${sig.source?.quote ?? ""} ${sig.date}`, [co.domain ?? "", "tenki.cloud"].filter(Boolean));
  return { ...t, review: { ...t.review, score: v.score, max_score: v.max, checks: v.checks, notes: t.review.notes.startsWith("verifier") ? t.review.notes : `verifier ${v.score}/${v.max}. ${t.review.notes}` } };
}

export const verifyText = (text: string, company: string, signal: string) =>
  call<VerifyResult>("/verify", () => localVerify(text, company, signal), post({ text, company, signal }));

// ---------- Learning loop: Thompson-sampling bandit ----------
const ARMS = [
  { id: "signal_hook__call", hook: "signal_hook", cta: "call", hook_text: "Lead with the cited signal", cta_text: "Worth a 15-min call this week?" },
  { id: "signal_hook__doc", hook: "signal_hook", cta: "doc", hook_text: "Lead with the cited signal", cta_text: "Want the one-page agent-sandbox architecture doc?" },
  { id: "warmpath_hook__call", hook: "warmpath_hook", cta: "call", hook_text: "Lead with the warm-path connector", cta_text: "Worth a 15-min call this week?" },
  { id: "warmpath_hook__doc", hook: "warmpath_hook", cta: "doc", hook_text: "Lead with the warm-path connector", cta_text: "Want the one-page agent-sandbox architecture doc?" },
];
// SIMULATED true reply rates (demo only) — mirrors api/app/bandit.py.
const SIM_RATES: Record<string, number> = { signal_hook__call: 0.04, signal_hook__doc: 0.07, warmpath_hook__call: 0.06, warmpath_hook__doc: 0.11 };

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gamma(k: number, r: () => number): number {
  if (k < 1) return gamma(k + 1, r) * Math.pow(r(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      const u1 = r() || 1e-12, u2 = r();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const beta = (a: number, b: number, r: () => number) => { const x = gamma(a, r); return x / (x + gamma(b, r)); };

type Stats = Record<string, [number, number]>;
const freshStats = (): Stats => Object.fromEntries(ARMS.map((a) => [a.id, [1, 1]])) as Stats;
const pick = (st: Stats, r: () => number) => ARMS.map((a) => a.id).reduce((best, id) => {
  const s = beta(st[id][0], st[id][1], r);
  return s > best.s ? { id, s } : best;
}, { id: ARMS[0].id, s: -1 }).id;
function shares(st: Stats): Record<string, number> {
  const r = mulberry(7);
  const wins: Record<string, number> = Object.fromEntries(ARMS.map((a) => [a.id, 0]));
  for (let i = 0; i < 300; i++) wins[pick(st, r)]++;
  return Object.fromEntries(ARMS.map((a) => [a.id, Math.round((wins[a.id] / 300) * 1000) / 1000]));
}
function banditState(st: Stats, history: BanditState["history"], simulated: boolean): BanditState {
  const sh = shares(st);
  const arms = ARMS.map((a) => {
    const [al, be] = st[a.id];
    return { ...a, sent: al + be - 2, replies: al - 1, mean: Math.round((al / (al + be)) * 1000) / 1000, share: sh[a.id] };
  });
  return { arms, history, simulated, total_sent: arms.reduce((n, a) => n + a.sent, 0) };
}
let localBandit: BanditState = banditState(freshStats(), [{ step: 0, shares: shares(freshStats()) }], false);

function localSimulate(sends: number, seed = Date.now() % 100000): BanditState {
  const r = mulberry(seed);
  const st = freshStats();
  const history: BanditState["history"] = [{ step: 0, shares: shares(st) }];
  const every = Math.max(1, Math.floor(sends / 30));
  for (let i = 1; i <= sends; i++) {
    const arm = pick(st, r);
    st[arm][r() < SIM_RATES[arm] ? 0 : 1]++;
    if (i % every === 0 || i === sends) history.push({ step: i, shares: shares(st) });
  }
  localBandit = banditState(st, history, true);
  return localBandit;
}

export const getBandit = () => call<BanditState>("/bandit", () => localBandit);
export const simulateBandit = (sends = 300, seed?: number) =>
  call<BanditState>("/bandit/simulate", () => localSimulate(sends, seed), post({ sends, seed }));
export const resetBanditSim = () =>
  call<BanditState>("/bandit/reset", () => (localBandit = banditState(freshStats(), [{ step: 0, shares: shares(freshStats()) }], false)), post());
