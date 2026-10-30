// The frozen contract between the web app and the API (api/ mirrors these in Pydantic).

export type Source = { url: string; title: string; quote: string; fetched_at: string; verified: boolean };

export type Scored<T> = { value: T; confidence: number; sources?: Source[] }; // confidence 0.00–1.00

export type Intake = {
  product_name: string;
  product_url: string;
  description: string;
  features: string[];
  constraints: string[];
  reference_customers: string[];
  pricing_model: string;
  acv_usd: number | null;
  lost_deal?: string;
  past_employers?: string[]; // founder's own history → (me)-[:previously_employed_at] for warm paths
};

export type ICP = {
  industries: Scored<{ name: string; naics: string }>[];
  company_size: Scored<{ min_headcount: number; max_headcount: number; revenue_band: string }>;
  personas: Scored<{ title: string; seniority: string; function: string }>[];
  triggers: Scored<{ type: "funding" | "exec_hire" | "job_post" | "tech_change" | "launch"; description: string }>[];
  negative_signals: string[];
  regions: string[];
};

export type ExpansionSegment = {
  id: string;
  name: string;
  rationale: string;
  confidence: number;
  sources: Source[];
  status: "suggested" | "accepted" | "adjusted" | "dismissed";
};

export type Signal = {
  id: string;
  company_id: string;
  type: "funding" | "exec_hire" | "job_post" | "tech_change" | "launch" | "churn_risk";
  summary: string;
  date: string;
  source: Source;
};

export type Company = {
  id: string;
  name: string;
  domain: string;
  industry: string;
  naics: string;
  headcount: number;
  hq: string;
  fit: number; // 0–60
  intent: number; // 0–40
  score: number; // 0–100
  tier: "A" | "B" | "C";
  signals: Signal[];
  competitors_used: string[];
  sources: Source[];
};

export type Enrichment = {
  email: string | null;
  email_status: "valid" | "accept_all" | "invalid" | "unknown" | "pending";
  mx_ok: boolean | null;
  linkedin_url: string | null;
  provider: "hunter" | "apollo" | "seed" | null;
  confidence: number;
};

export type Person = {
  id: string;
  company_id: string;
  name: string;
  title: string;
  seniority: string;
  enrichment: Enrichment;
  sources: Source[];
};

export type WarmPath = { lead_id: string; hops: { from: string; rel: string; to: string }[]; cypher: string };

export type Stage = "matched" | "contacted" | "replied" | "meeting" | "closed_won" | "closed_lost";
export type Actor = "ai" | "rep";

export type Lead = {
  id: string;
  person_id: string;
  company_id: string;
  stage: Stage;
  owner: Actor; // who moved it last
  variant: "A" | "B";
  updated_at: string;
};

export type Touch = {
  id: string;
  lead_id: string;
  step: number; // 1..3
  channel: "email" | "linkedin";
  subject?: string;
  body: string;
  signal_id: string;
  variant: "A" | "B";
  arm?: string; // bandit arm id, e.g. "warmpath_hook__doc"
  status: "draft" | "approved" | "edited" | "rejected" | "sent";
  review: {
    verdict: "pass" | "fix" | "fail";
    notes: string;
    agent: "reviewer";
    score?: number; // verifier score (same function = GRPO reward)
    max_score?: number;
    checks?: VerifierCheck[];
  };
  security: { verdict: "pass" | "fail"; notes: string; agent: "security" };
};

export type AuditEvent = {
  id: string;
  at: string;
  actor: Actor;
  agent?: "planner" | "builder" | "reviewer" | "security" | "icp" | "discovery" | "enricher";
  action: string;
  lead_id?: string;
  detail: string;
};

export type ThinkingStep = {
  id: string;
  at: string;
  agent: string;
  kind: "reason" | "search" | "graph" | "validate" | "meter" | "handoff";
  text: string;
  cypher?: string;
};

export type Credits = { balance: number; granted: number; used: { lead_enriched: number; outreach_sent: number; graph_query: number }; blocked: boolean };

export type GraphData = {
  nodes: { id: string; label: string; type: "Company" | "Person" | "Product" | "Competitor" | "Signal" | "Me" }[];
  links: { source: string; target: string; rel: string }[];
};

// ---------- Learning loop (bandit + verifier) ----------
export type VerifierCheck = { name: string; pass: boolean; detail?: string };
export type VerifyResult = { score: number; max?: number; checks: VerifierCheck[] };
export type BanditArm = {
  id: string;
  hook: string;
  cta: string;
  hook_text?: string;
  cta_text?: string;
  sent: number;
  replies: number;
  mean: number;
  share: number;
};
export type BanditState = {
  arms: BanditArm[];
  history: { step: number; shares: Record<string, number> }[];
  simulated: boolean;
  total_sent?: number;
};
