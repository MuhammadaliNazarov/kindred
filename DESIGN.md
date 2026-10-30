# Kindred: the AI GTM Engine that only says what it can prove

Hackathon build for the "AI GTM Engine" spec (29 Oct 2026). Working name: **Kindred**. This file is the System Design &
Architecture Document (a required deliverable) and the plan every build agent reads first.

## 1. What the judges score, and how we win each line

| Criterion | Weight | Our answer |
|---|---|---|
| ICP & Discovery | 20% | ICP with a confidence score on every field, real leads, and a **source link on every claim** (no link = the row is dropped). Expansion segments, each with its evidence, accept/adjust/dismiss. |
| Enrichment & Outreach | 20% | Hunter/Apollo waterfall with an MX check and a verified badge. Messages built from **one cited trigger signal** ("why now"). A HITL queue: nothing sends without a human click. |
| Dashboard & Leads | 15% | Kanban Matched → Contacted → Replied → Meeting → Closed/Lost. Every card shows **AI or rep** for each move. Funnel by industry/tier, plus A/B by variant. |
| Startup viability | 15% | The wedge is **evidence + warm paths**: Clay/Unify find leads, while we show *why now* and *who can introduce you*, with proof. Per-lead cost is visible (Flexprice). |
| Technical execution | 10% | One repo, clean modules, deployed on a Tenki sandbox preview URL. The demo runs end to end live. |
| **Band** (bonus) | +20 | Planner, Builder, Reviewer and Security agents work in a Band room with @mentions. The human approves schema changes and sends in the same room. Live token and cost telemetry. |
| **Flexprice** (bonus) | +20 | Meters `lead_enriched`, `outreach_sent` and `graph_query`. Credit wallet per org. **Enrichment is blocked when credits run out** (shown live in the demo). |
| **Snyk** (bonus) | +20 if counted | Snyk SAST + SCA as a GitHub Action on every push. Badge in the README, scan of the outbound-dispatch service. Cheap to add, so we do it. |

Rules we never break: every prospect claim has a source URL, nothing is sent without HITL approval, and we use only public data. In the
demo, mail goes to **our own test inboxes only**, never to real prospects.

## 2. What people who built this learned (research, 30 Oct)

- Signal-triggered outreach wins: users report about 80% open and 5% reply on intent-triggered sends, against about 30% and under 1% for cold lists
  (Unify, Superframeworks 2026). → Every message leads with one dated, cited signal.
- "Claude is the brain, MCP is the wiring": ICP → signals (job posts) → qualify → write → follow-up (G. Bardet on X).
  Job posts are the best free signal. → Job-post ingestion is our main signal source.
- Builders score ICP fit 1–5 from the company site, then find founders (Lirim K. on X). → Fit is scored from site evidence, not
  only firmographics.
- GTM campaign context kept as a knowledge graph (Shann³, "Marketing Engineer", X) → our core data model, not a feature.
- Clay hit $100M ARR on waterfall enrichment and AI columns → we copy the table UX (a dense grid with enrichment badges), not the
  pricing.

## 3. The product flow (5 screens; this order is the demo)

1. **Intake.** Chat and form side by side. The founder pastes the product URL plus 3 sentences. The agent asks for 3 missing things (best
   customer, price/ACV, a deal they lost) and fills the structured form live.
2. **ICP.** Cards for industries (NAICS), size bands, personas, triggers, and a confidence bar on each field. Below them, **Expansion
   segments**, each with evidence links and accept/adjust/dismiss.
3. **Discovery and graph.** A dense grid of accounts and buyers: fit score 0–100, tier A/B/C, the signal, and the source chip. A right pane
   draws the graph around the selected lead: the warm path ("you → ex-colleague at X → buyer") and competitor displacement.
   Collapsible **Agent Thinking** feed.
4. **Outreach queue (HITL).** Per lead: a 3-touch sequence (email ×2, LinkedIn ×1), with the signal and its citation pinned on top and
   the variant label. Approve / Edit / Reject. The Reviewer's verdict and the Security agent's link check show inline.
5. **Pipeline.** Kanban plus analytics: stage conversion by industry/tier, A/B by variant, an audit log (who/what/when, AI vs
   rep), and a credits meter (Flexprice) in the header.

Demo product to feed in: **Tenki** (the sandbox sponsor). It's real, the judges know it, and buyers are easy to find
(AI-agent startups hiring infra engineers).

## 4. Runtime agent graph (inside the product)

```
                    ┌──────────── Band room "gtm-<org>" (humans + agents, @mentions) ────────────┐
 intake ─► PLANNER ─► ICP agent ─► DISCOVERY (Tavily/Serper + Playwright, job posts, news) ─► GRAPH writer (Neo4j)
             │                                   │                                              │
             │                     FLEXPRICE gate (credits?) ─► ENRICHER (Hunter → Apollo waterfall, MX)
             │                                                                                  │
             └──────────► BUILDER/COPY (signal + warm path + persona rules) ─► REVIEWER (fact + citation check)
                                                                                 ─► SECURITY (links, PII, domains)
                                                                                 ─► HITL queue ─► human Approve ─► SendGrid
 replies (SendGrid inbound webhook) ─► classifier ─► Kanban stage + graph edge replied_to ─► Planner re-plans
```

- **Band roles (spec names):** Planner/Architect, Builder (enrich, graph mutations, copy), Reviewer and Security. Each is a Band
  remote agent (`band-sdk[anthropic]`). Handoffs are @mentions. Any schema change or send waits for a human "approve" in the room.
  Token use and cost stream to the dashboard (Band `Emit.USAGE`).
- **No-hallucination rule (code, not prompt):** discovery returns `{claim, url, quote}`. A validator fetches the URL and checks
  the quote, and anything that fails is dropped before it reaches the graph.
- **Scoring:** fit (0–60, ICP match from cited evidence) + intent (0–40, signal recency × strength) = 0–100. A ≥ 75,
  B ≥ 50, else C.

## 5. Knowledge graph (Neo4j AuraDB Free)

Nodes: `Company`, `Person`, `Product`, `Competitor`, `Signal` (plus `Message`, `Source`). Edges (from the spec): `works_at`, `competes_with`,
`matched_to`, `contacted_via`, `replied_to`, `previously_employed_at`, plus `has_signal` and `cited_by`.

Three demo queries (multi-hop; we show the Cypher in the Agent Thinking panel):
1. **Warm path:** `(me)-[:previously_employed_at|works_at*1..3]-(buyer)`, shared past employers within 3 hops.
2. **Hiring → evaluation:** a company with a `Signal{type:'job_post'}` that mentions a competitor's or our category keywords in the last 30 days.
3. **Displacement:** `(co)-[:uses]->(competitor)` with a renewal or churn signal (review, status-page outage, pricing change).

## 6. Stack (as the spec asks)

| Tier | Choice |
|---|---|
| Frontend | Next.js 15 (App Router) + Tailwind + Radix UI; TanStack Table (grid), dnd-kit (Kanban), react-force-graph (graph pane) |
| API and agents | Python FastAPI + Band SDK (Anthropic adapter, Claude Sonnet 5.5); SSE stream for Agent Thinking |
| Graph | Neo4j AuraDB Free (Cypher) |
| Search/scrape | Tavily (search with sources) + Serper (news/jobs) + Playwright (page fetch for quote checks) |
| Enrichment | Hunter.io (email finder + verifier) → Apollo (fallback); Clearbit-style domain lookup via Hunter domain search |
| Messaging | SendGrid (send + inbound parse webhook); LinkedIn = copy-to-clipboard task (no unofficial API) |
| Billing | Flexprice Cloud (Python SDK): events, wallet/credits, feature limit check before enrichment |
| Security | Snyk GitHub Action (code + open source); secrets only in Tenki secrets / `.env` |
| Run/deploy | Tenki sandboxes (from the $400 credit); public demo via a `tenki sandbox preview-url` |

## 7. Build graph (how we build it, front end first)

Frontend first, against a **frozen API contract** (`contracts/openapi.yaml`) and seeded mock data, so the UI demos in hours and the
backend swaps in behind it.

| Wave | Agents (in parallel) | Output |
|---|---|---|
| 0 | Architect | repo skeleton, `contracts/openapi.yaml`, `types.ts`, seed JSON (Tenki demo data) |
| 1 (frontend) | FE-Intake, FE-ICP, FE-Discovery+Graph, FE-Outreach (HITL), FE-Pipeline+Analytics, FE-Shell (layout, Agent Thinking panel, credits meter) | 5 screens on mock data, deployed to a preview URL |
| 2 (backend) | BE-ICP, BE-Discovery+validator, BE-Graph, BE-Enrich, BE-Outreach+SendGrid | the real endpoints behind the same contract |
| 3 (bonus) | Band agents, Flexprice meter + gate, Snyk CI | +60 marks |
| 4 (check) | QA (Playwright end to end), Reviewer (rules: citations, HITL), Demo-script writer | video script, README, this doc updated |

Every wave ends with a running preview URL on Tenki and a check against §1.

## 8. The 4.5-hour plan (decided 30 Oct)

- Graph store: **Kùzu embedded** (Cypher, no account, `pip install kuzu`). Neo4j stays an option behind the same interface.
- Every integration has a **live mode when its key is set and a seeded fallback when it isn't**, so the demo never breaks.
- Demo product: Tenki. Mail: SendGrid to our own inbox only.

| Time | Do |
|---|---|
| 0:00–0:20 | Skeleton, contract, Tenki seed data |
| 0:20–1:45 | Frontend: 5 screens on seed data (parallel agents) |
| 1:45–3:00 | Backend: Claude ICP + copy, Tavily discovery + quote validator, Kùzu graph, Hunter, HITL queue, Flexprice gate |
| 3:00–3:45 | Band 4-agent room, Snyk Action |
| 3:45–4:30 | Deploy on a Tenki preview URL, record the 2–3 min video, README |
