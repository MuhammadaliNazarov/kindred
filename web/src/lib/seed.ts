// Demo seed for Kindred. Product: Tenki (tenki.cloud). Every company and person below is FICTIONAL.
// All source URLs are placeholders (example.com) and verified:false, so the UI labels them "sample".
import type {
  AuditEvent,
  Company,
  Credits,
  ExpansionSegment,
  GraphData,
  ICP,
  Intake,
  Lead,
  Person,
  Signal,
  Source,
  Stage,
  ThinkingStep,
  Touch,
  WarmPath,
} from "./types";

const F = "2026-10-30T09:00:00Z";
const src = (slug: string, title: string, quote: string): Source => ({
  url: `https://example.com/${slug}`,
  title,
  quote,
  fetched_at: F,
  verified: false,
});

// ---------- Intake ----------
export const seedIntake: Intake = {
  product_name: "Tenki",
  product_url: "https://tenki.cloud",
  description:
    "Sandboxes and microVMs for AI agents, fast GitHub Actions runners, and AI code review. Usage-based pricing with $100 free credit.",
  features: ["Agent sandboxes (microVMs)", "GitHub Actions runners", "AI code review", "Preview URLs"],
  constraints: ["Public data only", "No sends without human approval"],
  reference_customers: ["Lumenfold Labs (sample)"],
  pricing_model: "Usage-based, $100 free credit",
  acv_usd: 18000,
  past_employers: ["Northfield Systems (sample)", "State University (sample)"],
  lost_deal: "Lost a 40-seat infra team to an in-house Firecracker setup: they wanted SOC 2 we did not have yet.",
};

// ---------- ICP ----------
export const seedICP: ICP = {
  industries: [
    {
      value: { name: "AI agent platforms", naics: "541511" },
      confidence: 0.91,
      sources: [src("icp/agents-hiring", "Job board: agent infra roles", "Hiring: engineer to run untrusted agent code in isolated sandboxes.")],
    },
    {
      value: { name: "Developer tools / SaaS", naics: "511210" },
      confidence: 0.82,
      sources: [src("icp/devtools-ci", "Engineering blog: CI costs", "Our GitHub Actions bill tripled after we added eval runs.")],
    },
    {
      value: { name: "Applied ML research labs", naics: "541715" },
      confidence: 0.64,
      sources: [src("icp/ml-labs", "Lab post: eval infra", "Each eval spins up hundreds of short-lived environments.")],
    },
  ],
  company_size: {
    value: { min_headcount: 15, max_headcount: 250, revenue_band: "$2M–$40M ARR" },
    confidence: 0.78,
    sources: [src("icp/size-band", "Sample customer list", "Best-fit accounts run 10–60 engineers with a platform owner.")],
  },
  personas: [
    {
      value: { title: "Head of Platform / Infra", seniority: "Director", function: "Engineering" },
      confidence: 0.88,
      sources: [src("icp/persona-platform", "Interview notes (sample)", "Platform lead owns the runner budget and sandbox security.")],
    },
    {
      value: { title: "CTO / Co-founder", seniority: "C-level", function: "Engineering" },
      confidence: 0.81,
      sources: [src("icp/persona-cto", "Founder thread (sample)", "At under 50 people the CTO signs every infra contract.")],
    },
    {
      value: { title: "Staff Engineer, Agents", seniority: "IC / Staff", function: "Engineering" },
      confidence: 0.57,
      sources: [src("icp/persona-staff", "Forum post (sample)", "I picked our sandbox vendor and my VP approved it.")],
    },
  ],
  triggers: [
    {
      value: { type: "job_post", description: "Posting for agent infra / sandbox / platform engineer" },
      confidence: 0.9,
      sources: [src("icp/trigger-jobs", "Job post (sample)", "You will build secure execution environments for our coding agent.")],
    },
    {
      value: { type: "funding", description: "Seed–Series B round in the last 90 days" },
      confidence: 0.76,
      sources: [src("icp/trigger-funding", "Funding news (sample)", "The round will fund scaling the agent runtime.")],
    },
    {
      value: { type: "tech_change", description: "Migrating CI off hosted runners or adopting microVMs" },
      confidence: 0.69,
      sources: [src("icp/trigger-tech", "Changelog (sample)", "We moved our CI from hosted runners to self-managed machines.")],
    },
    {
      value: { type: "exec_hire", description: "New VP Eng / Head of Platform hired" },
      confidence: 0.58,
      sources: [src("icp/trigger-exec", "Announcement (sample)", "Excited to join as Head of Platform.")],
    },
  ],
  negative_signals: [
    "Already runs an in-house Firecracker fleet",
    "Fewer than 5 engineers",
    "Regulated workloads needing SOC 2 Type II today",
    "No GitHub usage (GitLab-only shops)",
  ],
  regions: ["North America", "UK", "EU"],
};

// ---------- Expansion segments ----------
export const seedExpansions: ExpansionSegment[] = [
  {
    id: "x1",
    name: "AI eval and benchmark startups",
    rationale: "They spin up thousands of short-lived, isolated environments per eval run; usage-based microVMs map directly to their bill.",
    confidence: 0.74,
    sources: [
      src("exp/eval-startups", "Eval vendor blog (sample)", "Each benchmark run needs a clean VM so results are reproducible."),
      src("exp/eval-jobs", "Job post (sample)", "Own the infrastructure that runs 50k sandboxed evals a day."),
    ],
    status: "suggested",
  },
  {
    id: "x2",
    name: "EdTech coding platforms",
    rationale: "Run untrusted student code at scale; same isolation need as agents, with seasonal spikes that fit usage pricing.",
    confidence: 0.61,
    sources: [src("exp/edtech", "Platform engineering post (sample)", "We execute two million student submissions a week in containers.")],
    status: "suggested",
  },
  {
    id: "x3",
    name: "Security research tooling",
    rationale: "Detonating samples and fuzzing need disposable microVMs; smaller market but high ACV.",
    confidence: 0.47,
    sources: [src("exp/secresearch", "Conference talk (sample)", "Every sample runs in a throwaway VM that dies after 60 seconds.")],
    status: "suggested",
  },
];

// ---------- Companies (fictional) ----------
type CSeed = [id: string, name: string, industry: string, naics: string, headcount: number, hq: string, fit: number, intent: number, comps: string[]];
const cSeeds: CSeed[] = [
  ["c1", "Lumenfold Labs", "AI agent platforms", "541511", 48, "San Francisco, CA", 56, 37, ["VMForge"]],
  ["c2", "Quillstack", "Developer tools / SaaS", "511210", 92, "Austin, TX", 52, 31, ["BoxRun"]],
  ["c3", "Orrery Agents", "AI agent platforms", "541511", 23, "New York, NY", 54, 30, []],
  ["c4", "Tallowmere AI", "Applied ML research labs", "541715", 140, "Toronto, ON", 47, 29, ["CIStack"]],
  ["c5", "Brindle Systems", "Developer tools / SaaS", "511210", 61, "London, UK", 49, 24, ["BoxRun"]],
  ["c6", "Pellucid Robotics", "Applied ML research labs", "541715", 210, "Boston, MA", 41, 26, []],
  ["c7", "Halyard Dev", "Developer tools / SaaS", "511210", 34, "Berlin, DE", 44, 21, ["CIStack"]],
  ["c8", "Mossgrove Studio", "AI agent platforms", "541511", 17, "Seattle, WA", 46, 18, []],
  ["c9", "Wickerlight", "AI agent platforms", "541511", 76, "Denver, CO", 39, 20, ["VMForge"]],
  ["c10", "Ferrule Cloud", "Developer tools / SaaS", "511210", 180, "Dublin, IE", 33, 14, ["BoxRun", "CIStack"]],
  ["c11", "Cobaltine Data", "Applied ML research labs", "541715", 240, "Chicago, IL", 30, 12, []],
  ["c12", "Starling Forge", "Developer tools / SaaS", "511210", 12, "Portland, OR", 28, 9, []],
];

type SSeed = [id: string, company: string, type: Signal["type"], summary: string, date: string];
const sSeeds: SSeed[] = [
  ["s1", "c1", "job_post", "Hiring a Sandbox Infrastructure Engineer to run untrusted agent code", "2026-10-24"],
  ["s2", "c1", "funding", "Raised a $14M Series A to scale its coding agent", "2026-10-02"],
  ["s3", "c2", "tech_change", "Moved CI off hosted runners after a 3x bill increase", "2026-10-18"],
  ["s4", "c3", "job_post", "Posting for Founding Platform Engineer, agent runtime", "2026-10-21"],
  ["s5", "c4", "launch", "Launched a public eval harness running nightly benchmarks", "2026-10-11"],
  ["s6", "c5", "exec_hire", "New Head of Platform joined from a large fintech", "2026-10-15"],
  ["s7", "c6", "job_post", "Hiring ML infra engineer for simulation sandboxes", "2026-10-09"],
  ["s8", "c7", "funding", "Closed a $6M seed round", "2026-09-29"],
  ["s9", "c8", "launch", "Launched an agent that opens pull requests on its own", "2026-10-20"],
  ["s10", "c9", "tech_change", "Evaluating microVM isolation for customer code", "2026-10-06"],
  ["s11", "c10", "churn_risk", "Public complaints about flaky self-hosted runners", "2026-10-12"],
  ["s12", "c11", "job_post", "Hiring a platform engineer for research clusters", "2026-09-30"],
  ["s13", "c12", "launch", "Shipped a GitHub App for automated reviews", "2026-10-01"],
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export const seedSignals: Signal[] = sSeeds.map(([id, company_id, type, summary, date]) => ({
  id,
  company_id,
  type,
  summary,
  date,
  source: src(`signals/${id}`, `${type.replace("_", " ")} (sample)`, summary),
}));

export const seedCompanies: Company[] = cSeeds.map(([id, name, industry, naics, headcount, hq, fit, intent, comps]) => {
  const score = fit + intent;
  return {
    id,
    name,
    domain: `${slug(name)}.example`,
    industry,
    naics,
    headcount,
    hq,
    fit,
    intent,
    score,
    tier: score >= 75 ? "A" : score >= 60 ? "B" : "C",
    signals: seedSignals.filter((s) => s.company_id === id),
    competitors_used: comps,
    sources: [src(`companies/${id}`, `${name} about page (sample)`, `${name} builds software with a team of about ${headcount}.`)],
  };
});

// ---------- People (fictional) ----------
type PSeed = [id: string, company: string, name: string, title: string, seniority: string, status: Person["enrichment"]["email_status"], provider: Person["enrichment"]["provider"], conf: number];
const pSeeds: PSeed[] = [
  ["p1", "c1", "Mira Castellane", "Head of Platform", "Director", "valid", "hunter", 0.94],
  ["p2", "c1", "Jonah Pekkala", "CTO", "C-level", "valid", "hunter", 0.9],
  ["p3", "c2", "Ines Varga-Holm", "VP Engineering", "VP", "accept_all", "apollo", 0.71],
  ["p4", "c2", "Rafe Dunmore", "Staff Engineer, CI", "IC / Staff", "valid", "hunter", 0.86],
  ["p5", "c3", "Talia Brookhart", "Co-founder & CTO", "C-level", "valid", "hunter", 0.92],
  ["p6", "c4", "Oskar Lindqvar", "Head of ML Infra", "Director", "valid", "apollo", 0.83],
  ["p7", "c4", "Priya Anandaraj", "Research Engineer", "IC / Staff", "unknown", "apollo", 0.48],
  ["p8", "c5", "Callum Ashgrove", "Head of Platform", "Director", "valid", "hunter", 0.88],
  ["p9", "c6", "Noor Haddadin", "Director, Simulation", "Director", "accept_all", "apollo", 0.66],
  ["p10", "c7", "Lena Brauwer", "CTO", "C-level", "valid", "hunter", 0.89],
  ["p11", "c8", "Emeka Obiorah", "Founder", "C-level", "valid", "seed", 0.8],
  ["p12", "c9", "Sasha Velichko", "Platform Lead", "Manager", "pending", null, 0],
  ["p13", "c9", "Dario Fennimore", "VP Engineering", "VP", "valid", "hunter", 0.84],
  ["p14", "c10", "Hollis Quaye", "Director of DevEx", "Director", "invalid", "apollo", 0.2],
  ["p15", "c10", "Wren Takamura", "Staff Engineer, Agents", "IC / Staff", "accept_all", "apollo", 0.62],
  ["p16", "c11", "Bastian Ruehl", "Head of Research Infra", "Director", "valid", "hunter", 0.81],
  ["p17", "c12", "Odette Marchetti", "Co-founder", "C-level", "valid", "hunter", 0.87],
  ["p18", "c3", "Kieran Solloway", "Founding Engineer", "IC / Staff", "unknown", "seed", 0.4],
];

export const seedPeople: Person[] = pSeeds.map(([id, company_id, name, title, seniority, status, provider, conf]) => {
  const co = cSeeds.find((c) => c[0] === company_id)!;
  const first = name.split(" ")[0].toLowerCase();
  return {
    id,
    company_id,
    name,
    title,
    seniority,
    enrichment: {
      email: status === "pending" ? null : `${first}@${slug(co[1])}.example`,
      email_status: status,
      mx_ok: status === "pending" ? null : status !== "invalid",
      linkedin_url: `https://example.com/in/${slug(name)}`,
      provider,
      confidence: conf,
    },
    sources: [src(`people/${id}`, `${name} team page (sample)`, `${name}, ${title} at ${co[1]}.`)],
  };
});

// ---------- Leads ----------
type LSeed = [id: string, person: string, stage: Stage, owner: Lead["owner"], variant: Lead["variant"], at: string];
const lSeeds: LSeed[] = [
  ["l1", "p1", "meeting", "rep", "A", "2026-10-29T16:10:00Z"],
  ["l2", "p2", "replied", "ai", "B", "2026-10-29T11:40:00Z"],
  ["l3", "p3", "contacted", "ai", "A", "2026-10-28T14:02:00Z"],
  ["l4", "p4", "replied", "rep", "A", "2026-10-29T09:15:00Z"],
  ["l5", "p5", "closed_won", "rep", "B", "2026-10-27T17:30:00Z"],
  ["l6", "p6", "meeting", "rep", "B", "2026-10-29T13:20:00Z"],
  ["l7", "p7", "matched", "ai", "A", "2026-10-30T08:05:00Z"],
  ["l8", "p8", "contacted", "ai", "B", "2026-10-28T10:45:00Z"],
  ["l9", "p9", "matched", "ai", "B", "2026-10-30T08:06:00Z"],
  ["l10", "p10", "replied", "ai", "A", "2026-10-29T15:55:00Z"],
  ["l11", "p11", "closed_won", "rep", "A", "2026-10-26T12:00:00Z"],
  ["l12", "p12", "matched", "ai", "A", "2026-10-30T08:07:00Z"],
  ["l13", "p13", "contacted", "ai", "A", "2026-10-28T16:30:00Z"],
  ["l14", "p14", "closed_lost", "rep", "B", "2026-10-27T10:10:00Z"],
  ["l15", "p15", "contacted", "ai", "B", "2026-10-28T09:00:00Z"],
  ["l16", "p16", "matched", "ai", "B", "2026-10-30T08:08:00Z"],
  ["l17", "p17", "contacted", "ai", "A", "2026-10-28T11:25:00Z"],
  ["l18", "p18", "matched", "ai", "B", "2026-10-30T08:09:00Z"],
];

export const seedLeads: Lead[] = lSeeds.map(([id, person_id, stage, owner, variant, updated_at]) => ({
  id,
  person_id,
  company_id: pSeeds.find((p) => p[0] === person_id)![1],
  stage,
  owner,
  variant,
  updated_at,
}));

// ---------- Touches ----------
const pass = { verdict: "pass" as const, notes: "Signal cited, claim matches source, tone plain.", agent: "reviewer" as const };
const secPass = { verdict: "pass" as const, notes: "All links resolve to allowed domains; no tracking pixels.", agent: "security" as const };
export const seedTouches: Touch[] = [
  {
    id: "t1", lead_id: "l3", step: 1, channel: "email", variant: "A", signal_id: "s3", status: "draft",
    subject: "Your CI bill after leaving hosted runners",
    body: "Hi Ines, saw Quillstack moved CI off hosted runners after the bill tripled (link). Tenki runs GitHub Actions on microVMs, billed per second, with $100 free credit to compare a week of runs. Worth a 15-minute look?",
    review: pass, security: secPass,
  },
  {
    id: "t2", lead_id: "l3", step: 2, channel: "email", variant: "A", signal_id: "s3", status: "draft",
    subject: "Re: CI bill",
    body: "Following up with one number: teams switching runners typically see eval-heavy pipelines finish faster. Happy to send a side-by-side for one of your repos.",
    review: { verdict: "fix", notes: "\"typically see ... faster\" has no source. Cite a benchmark or remove the claim.", agent: "reviewer" },
    security: secPass,
  },
  {
    id: "t3", lead_id: "l3", step: 3, channel: "linkedin", variant: "A", signal_id: "s3", status: "draft",
    body: "Ines, enjoyed the Quillstack post on CI costs. Building runner infra at Tenki and would value your take.",
    review: pass, security: secPass,
  },
  {
    id: "t4", lead_id: "l8", step: 1, channel: "email", variant: "B", signal_id: "s6", status: "draft",
    subject: "Congrats on the new platform role",
    body: "Hi Callum, congrats on joining Brindle as Head of Platform (link). New platform leads often revisit sandboxing first; Tenki gives each agent run its own microVM. Open to comparing notes?",
    review: pass,
    security: { verdict: "fail", notes: "Link points to an unverified shortener (bit.example/x9). Replace with the original source URL.", agent: "security" },
  },
  {
    id: "t5", lead_id: "l13", step: 1, channel: "email", variant: "A", signal_id: "s10", status: "approved",
    subject: "MicroVM isolation for customer code",
    body: "Hi Dario, noticed Wickerlight is evaluating microVM isolation for customer code (link). That is exactly what Tenki sandboxes do, with boot in under a second. Want a test account with $100 credit?",
    review: pass, security: secPass,
  },
  {
    id: "t6", lead_id: "l15", step: 1, channel: "email", variant: "B", signal_id: "s11", status: "draft",
    subject: "Flaky self-hosted runners",
    body: "Hi Wren, saw the thread about flaky self-hosted runners at Ferrule (link). Tenki runners are managed and per-second billed. Could I set up a trial on one repo?",
    review: pass, security: secPass,
  },
  {
    id: "t7", lead_id: "l17", step: 1, channel: "email", variant: "A", signal_id: "s13", status: "sent",
    subject: "Your new GitHub review app",
    body: "Hi Odette, congrats on shipping the Starling review app (link). If your checks run on Actions, Tenki runners can cut the wait. Want me to send setup steps?",
    review: pass, security: secPass,
  },
  {
    id: "t8", lead_id: "l17", step: 2, channel: "email", variant: "A", signal_id: "s13", status: "approved",
    subject: "Re: review app",
    body: "Quick follow-up: one-line change in your workflow file (runs-on: tenki). Free credit covers a few weeks for a team your size.",
    review: pass, security: secPass,
  },
  {
    id: "t9", lead_id: "l2", step: 1, channel: "email", variant: "B", signal_id: "s2", status: "sent",
    subject: "Scaling the agent runtime after the Series A",
    body: "Hi Jonah, congrats on the Series A (link). If scaling the agent runtime is next, Tenki gives each run an isolated microVM. Happy to share how similar teams set it up.",
    review: pass, security: secPass,
  },
  {
    id: "t10", lead_id: "l10", step: 1, channel: "email", variant: "A", signal_id: "s8", status: "sent",
    subject: "After the seed: CI and sandboxes",
    body: "Hi Lena, congrats on the seed (link). Teams at your stage usually want fast CI without running machines. Tenki covers runners and agent sandboxes in one bill.",
    review: pass, security: secPass,
  },
  {
    id: "t11", lead_id: "l7", step: 1, channel: "linkedin", variant: "A", signal_id: "s5", status: "draft",
    body: "Priya, the Tallowmere eval harness launch looked great. Curious how you isolate nightly benchmark runs.",
    review: pass, security: secPass,
  },
  {
    id: "t12", lead_id: "l9", step: 1, channel: "email", variant: "B", signal_id: "s7", status: "edited",
    subject: "Simulation sandboxes",
    body: "Hi Noor, saw Pellucid is hiring for simulation sandboxes (link). Tenki microVMs boot fast and bill per second. Worth a quick call?",
    review: pass, security: secPass,
  },
];

// ---------- Audit ----------
type ASeed = [at: string, actor: AuditEvent["actor"], agent: AuditEvent["agent"] | undefined, action: string, lead: string | undefined, detail: string];
const aSeeds: ASeed[] = [
  ["2026-10-26T09:00:00Z", "rep", undefined, "intake.submitted", undefined, "Founder submitted Tenki intake"],
  ["2026-10-26T09:01:10Z", "ai", "icp", "icp.generated", undefined, "ICP v1: 3 industries, 3 personas, 4 triggers"],
  ["2026-10-26T09:02:00Z", "ai", "planner", "plan.created", undefined, "Planner split work: discovery, enrich, outreach"],
  ["2026-10-26T09:05:30Z", "ai", "discovery", "companies.found", undefined, "12 accounts matched, 13 signals cited"],
  ["2026-10-26T09:08:12Z", "ai", "enricher", "lead.enriched", "l5", "Email verified via Hunter (valid, MX ok)"],
  ["2026-10-26T09:08:40Z", "ai", "enricher", "lead.enriched", "l11", "Email verified via seed provider"],
  ["2026-10-26T10:00:00Z", "rep", undefined, "touch.approved", "l11", "Rep approved touch 1 for Mossgrove Studio"],
  ["2026-10-26T12:00:00Z", "rep", undefined, "lead.moved", "l11", "meeting → closed_won"],
  ["2026-10-27T10:10:00Z", "rep", undefined, "lead.moved", "l14", "replied → closed_lost (runs in-house fleet)"],
  ["2026-10-27T17:30:00Z", "rep", undefined, "lead.moved", "l5", "meeting → closed_won"],
  ["2026-10-28T09:00:00Z", "ai", "builder", "touch.drafted", "l15", "3-touch sequence drafted, variant B"],
  ["2026-10-28T10:45:00Z", "ai", "builder", "touch.drafted", "l8", "3-touch sequence drafted, variant B"],
  ["2026-10-28T10:46:00Z", "ai", "security", "touch.flagged", "l8", "Security fail: unverified shortener link"],
  ["2026-10-28T11:25:00Z", "ai", undefined, "lead.moved", "l17", "matched → contacted after send"],
  ["2026-10-28T14:02:00Z", "ai", "builder", "touch.drafted", "l3", "3-touch sequence drafted, variant A"],
  ["2026-10-28T14:03:00Z", "ai", "reviewer", "touch.flagged", "l3", "Reviewer fix: uncited performance claim in touch 2"],
  ["2026-10-28T16:30:00Z", "rep", undefined, "touch.approved", "l13", "Rep approved touch 1 for Wickerlight"],
  ["2026-10-29T09:15:00Z", "rep", undefined, "lead.moved", "l4", "contacted → replied"],
  ["2026-10-29T11:40:00Z", "ai", undefined, "lead.moved", "l2", "contacted → replied (inbound reply parsed)"],
  ["2026-10-29T13:20:00Z", "rep", undefined, "lead.moved", "l6", "replied → meeting"],
  ["2026-10-29T15:55:00Z", "ai", undefined, "lead.moved", "l10", "contacted → replied (inbound reply parsed)"],
  ["2026-10-29T16:10:00Z", "rep", undefined, "lead.moved", "l1", "replied → meeting via warm intro"],
  ["2026-10-30T08:05:00Z", "ai", "discovery", "lead.matched", "l7", "New lead from eval-harness launch signal"],
  ["2026-10-30T08:09:00Z", "ai", "discovery", "lead.matched", "l18", "New lead from founding-engineer job post"],
  ["2026-10-30T08:10:00Z", "ai", "enricher", "enrichment.queued", "l12", "Waterfall: Hunter → Apollo pending"],
];
export const seedAudit: AuditEvent[] = aSeeds.map(([at, actor, agent, action, lead_id, detail], i) => ({
  id: `a${i + 1}`,
  at,
  actor,
  ...(agent ? { agent } : {}),
  action,
  ...(lead_id ? { lead_id } : {}),
  detail,
}));

// ---------- Thinking ----------
type TSeed = [agent: string, kind: ThinkingStep["kind"], text: string, cypher?: string];
const tSeeds: TSeed[] = [
  ["planner", "reason", "Intake has product, ACV and a lost deal. Enough to draft an ICP."],
  ["icp", "search", "Searching job boards for 'sandbox', 'agent runtime', 'microVM' postings (last 30 days)."],
  ["icp", "reason", "Agent platforms dominate the hits; dev tools second via CI-cost posts."],
  ["icp", "validate", "Dropped 2 industry claims with no source URL."],
  ["planner", "handoff", "ICP ready. Handing off to @discovery with 4 triggers."],
  ["discovery", "search", "Pulling companies with a matching job post or funding round in 90 days."],
  ["discovery", "graph", "Writing 12 companies and 13 signals to the graph.", "UNWIND $rows AS r\nMERGE (c:Company {id: r.id})\nSET c += r.props\nWITH c, r UNWIND r.signals AS s\nMERGE (c)-[:HAS_SIGNAL]->(:Signal {id: s.id})"],
  ["discovery", "reason", "Lumenfold Labs: fit 56 + intent 37 = 93, tier A (job post 6 days old)."],
  ["discovery", "validate", "Dropped: quote not found at source. Claim 'Halyard Dev is hiring agent infra' removed (verified:false)."],
  ["enricher", "meter", "lead_enriched x1 (Hunter). Balance 241 → 240 credits."],
  ["enricher", "reason", "Hunter returned accept_all for Quillstack; falling back to Apollo."],
  ["enricher", "validate", "MX check failed for ferrulecloud.example; marking email invalid."],
  ["discovery", "graph", "Looking for a warm path from you to Mira Castellane.", "MATCH p = shortestPath((me:Me)-[*..4]-(b:Person {id: 'p1'}))\nRETURN p"],
  ["discovery", "reason", "Found 3 hops: you → Theo Brandt (ex-colleague) → Lumenfold Labs → Mira."],
  ["discovery", "graph", "Checking competitor displacement for tier A accounts.", "MATCH (c:Company)-[:USES]->(k:Competitor)\nWHERE c.tier = 'A'\nRETURN c.name, collect(k.name)"],
  ["builder", "reason", "Drafting 3 touches per lead, each opening with one dated, cited signal."],
  ["reviewer", "validate", "Touch t2: claim 'finish faster' has no source. Verdict: fix."],
  ["security", "validate", "Touch t4: link uses an unverified shortener. Verdict: fail."],
  ["builder", "handoff", "8 drafts queued for human review. Nothing sends without approval."],
  ["planner", "meter", "Run cost so far: 160 of 400 credits used."],
];
export const seedThinking: ThinkingStep[] = tSeeds.map(([agent, kind, text, cypher], i) => ({
  id: `th${i + 1}`,
  at: new Date(Date.parse("2026-10-30T09:00:00Z") + i * 4000).toISOString(),
  agent,
  kind,
  text,
  ...(cypher ? { cypher } : {}),
}));

// ---------- Credits ----------
export const seedCredits: Credits = {
  balance: 240,
  granted: 400,
  used: { lead_enriched: 96, outreach_sent: 40, graph_query: 24 },
  blocked: false,
};

// ---------- Graph ----------
const nodes: GraphData["nodes"] = [
  { id: "me", label: "Me", type: "Me" },
  { id: "tenki", label: "Tenki", type: "Product" },
  { id: "k1", label: "VMForge", type: "Competitor" },
  { id: "k2", label: "BoxRun", type: "Competitor" },
  { id: "k3", label: "CIStack", type: "Competitor" },
  { id: "x_theo", label: "Theo Brandt (ex-colleague)", type: "Person" },
  { id: "x_amara", label: "Amara Feld (investor)", type: "Person" },
  ...seedCompanies.map((c) => ({ id: c.id, label: c.name, type: "Company" as const })),
  ...seedPeople.map((p) => ({ id: p.id, label: p.name, type: "Person" as const })),
  ...["s1", "s3", "s6", "s10"].map((id) => ({ id, label: seedSignals.find((s) => s.id === id)!.summary.slice(0, 40), type: "Signal" as const })),
];
const compIds: Record<string, string> = { VMForge: "k1", BoxRun: "k2", CIStack: "k3" };
const links: GraphData["links"] = [
  { source: "me", target: "tenki", rel: "SELLS" },
  { source: "me", target: "x_theo", rel: "WORKED_WITH" },
  { source: "x_theo", target: "c1", rel: "WORKS_AT" },
  { source: "me", target: "x_amara", rel: "KNOWS" },
  { source: "x_amara", target: "c3", rel: "INVESTED_IN" },
  { source: "tenki", target: "k1", rel: "COMPETES_WITH" },
  { source: "tenki", target: "k2", rel: "COMPETES_WITH" },
  { source: "tenki", target: "k3", rel: "COMPETES_WITH" },
  ...seedPeople.map((p) => ({ source: p.id, target: p.company_id, rel: "WORKS_AT" })),
  ...seedCompanies.flatMap((c) => c.competitors_used.map((k) => ({ source: c.id, target: compIds[k], rel: "USES" }))),
  ...["s1", "s3", "s6", "s10"].map((id) => ({ source: seedSignals.find((s) => s.id === id)!.company_id, target: id, rel: "HAS_SIGNAL" })),
];
export const seedGraph: GraphData = { nodes, links };

// Warm paths. hops use GRAPH NODE IDS (look up labels in seedGraph.nodes).
export const seedWarmPaths: WarmPath[] = [
  {
    lead_id: "l1",
    hops: [
      { from: "me", rel: "WORKED_WITH", to: "x_theo" },
      { from: "x_theo", rel: "WORKS_AT", to: "c1" },
      { from: "c1", rel: "EMPLOYS", to: "p1" },
    ],
    cypher: "MATCH p = shortestPath((me:Me)-[*..4]-(b:Person {id: 'p1'}))\nRETURN p",
  },
  {
    lead_id: "l5",
    hops: [
      { from: "me", rel: "KNOWS", to: "x_amara" },
      { from: "x_amara", rel: "INVESTED_IN", to: "c3" },
      { from: "c3", rel: "EMPLOYS", to: "p5" },
    ],
    cypher: "MATCH p = shortestPath((me:Me)-[*..4]-(b:Person {id: 'p5'}))\nRETURN p",
  },
];
