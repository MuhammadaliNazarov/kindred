# Warmpath: startup viability (one page)

> **Clay finds leads. Warmpath tells you why now and who introduces you, and proves every claim.**

Written 30 Oct 2026 for the "Startup viability" line (15%) of the judging matrix in DESIGN.md §1. Numbers here are the single
source of truth for the README, the demo and Q&A. Prices in the product (billing.py, CreditsMeter) must match §3.

## 1. Problem, with evidence

A founder with no sales team has two bad options. Buy a lead database and spam it, or pay an "AI SDR" that makes things up.

- Cold lists barely work. Across 7.5M sends in 2025, Belkins measured a **0.45% reply rate** (replies ÷ sends);
  platform averages sit at **3.4–4.5%** (Instantly 3.43%, Hunter 4.5%). Sources: https://belkins.io/blog/cold-email-response-rates.md,
  https://instantly.ai/blog/cold-email-reply-rate-benchmarks, https://hunter.io/the-state-of-cold-email-2025
- Databases are wrong often enough to hurt. Roughly **500 of ~9,700 Apollo reviews on G2** (about 5%) explicitly flag
  inaccurate data. Source: https://prospeo.io/s/apolloio-reviews (count), https://g2.com/products/apollo-io/reviews
- Autonomous AI SDRs burn trust. TechCrunch's March 2025 investigation of 11x reported **70–80% churn** from former employees;
  11x disputed it and claimed 79% retention. Source (secondary coverage): https://www.onlycfo.io/p/ai-company-accused-of-fraud
- Credit bills are unpredictable. Clay's self-serve plans run **$185–$495/mo** with a reported 50% top-up surcharge when credits
  run out mid-month. Source: https://crustdata.com/reviews/clay, https://www.zeliq.com/blog/clay-pricing

The missing piece is not more leads. It is **proof** (why this company, why now, where it says so) and a **warm path** (who you
already know that can introduce you), at a price you can see before you click.

## 2. Who pays

A seed to Series A founder who still does the selling (no AE yet), selling B2B at a **$5–50k ACV**. Today they pay for Clay or
Apollo seats, hunt for mutual connections by hand on LinkedIn, or keep an SDR agency on retainer. One closed deal pays for a year
of Warmpath. Second buyer (post-hackathon): the first SDR hire at that same company.

## 3. Pricing: per verified lead, metered by Flexprice

No seats. You buy credits; Flexprice meters every event and blocks enrichment at zero (shown live in the demo).

| Event (Flexprice meter) | Credits | Price |
|---|---|---|
| `lead_verified` (claim validated at source + email verified) | 5 | **$1.00** |
| `outreach_sent` (after human approval) | 1 | $0.20 |
| `graph_query` (warm path, hiring signal) | 0.1 | $0.02 |

1 credit = $0.20. Founder pack: **$99 for 500 credits** (about 85 verified leads plus their sequences). Free: 50 credits.
Compare: Apollo charges **$0.20 per overage credit** and Clay Launch is $185/mo for 2,500 data credits, with no proof and no
warm path. You only pay for a lead when its evidence checks out; dropped claims cost nothing.
Sources: https://docket.io/resources/research/apollo-pricing, https://crustdata.com/reviews/clay

Unit economics (assumption, to verify): our cost per verified lead is about $0.15–0.25 (Tavily search, one page fetch,
Hunter verify, Claude tokens), so gross margin is ~75–85% at $1.00.

## 4. Market size (sourced, assumptions visible)

- **Category:** sales intelligence software is **$4.4B in 2025, forecast $9.2B by 2031** (Mordor, 12.9% CAGR). Other reports
  cluster at $4–4.9B for 2025. Source: https://mordorintelligence.com/industry-reports/sales-intelligence-market
- **Proof the budget exists:** Clay reached **$100M ARR in Dec 2025** and a $5B valuation in Jan 2026 selling enrichment to
  GTM teams. Sources: https://techcrunch.com/2025/08/05/clay-confirms-it-closed-100m-round-at-3-1b-valuation,
  https://www.businesswire.com/news/home/20260128514638/en/Clay-Announces-Second-Employee-Tender-Offer-in-Nine-Months-at-a-5B-Valuation
- **Our wedge, bottom-up:** Carta alone recorded ~1,700 new US seed rounds in 2025 (401, ~450, 457, 435 by quarter), and
  most seed companies never reach Series A, so they sell for 2–3 years on founder time. Source:
  https://carta.com/data/state-of-private-markets-q4-2025-full-report/
  Assumption: ~30,000 seed-to-A B2B startups actively selling worldwide × $3,000/yr (≈250 verified leads/mo) = **~$90M/yr
  serviceable market** for the founder wedge, before SDR teams.

## 5. Competitors (detail in IDEATION.md)

| Product | What they sell | Gap Warmpath fills |
|---|---|---|
| Clay, Apollo | Enrichment and big databases | No proof per claim; credit spend is unpredictable |
| Unify, Rox | Intent plays and revenue graphs for AE teams | Expensive, built for teams, not a solo founder |
| 11x (Alice), Origami | Autonomous or research agents | No human gate, acts on unverified data |

Nobody else drops a claim it cannot cite, shows the warm intro path from your own history, and prices per verified lead.

## 6. Why now

1. Frontier models can read a job post, score fit from a company's own site and write a relevant note in one pass, so research
   per lead costs cents, not an SDR hour.
2. Buyers have been burned (11x, Apollo accuracy complaints). "Show your receipts" is now a buying criterion.
3. Usage billing is off the shelf (Flexprice), so per-lead pricing takes an afternoon, not a billing team.

## 7. Moat

- **Proof graph.** Every `Signal` and `Company` node carries `cited_by` → `Source{url, quote}`. The validator drops anything it
  cannot find at the URL. Over time this becomes a verified, dated map of who is hiring, raising and switching, which no database
  vendor has because they never store the quote.
- **Warm-path data.** The founder's past employers and schools (and, post-hackathon, the full LinkedIn connections graph) are
  private edges only we hold. Each reply writes a `replied_to` edge, so the graph learns which paths and messages convert.
  Compounding, per customer, hard to copy from public data.

## 8. 90-day go-to-market

| Days | Do | Target |
|---|---|---|
| 0–30 | Ship the hackathon build as a free tier (50 credits). Post the demo on X and LinkedIn; message 50 founders in our own network, found with Warmpath. | 100 sign-ups, 10 paying founder packs |
| 31–60 | Price test per verified lead vs. a $99/mo subscription with 5 founders. Add LinkedIn CSV import for warm paths. Case study: one deal closed from a warm intro. | $2k MRR, 1 public case study |
| 61–90 | Partner with 3 accelerators (offer credits to each cohort). Launch the SDR-team plan with shared wallets. | $10k MRR, 2 accelerator deals |

## 9. Five judge questions, five answers

1. **"Why won't Clay just add this?"** Clay sells volume to teams and never stores the quote behind a claim, so it has no proof
   graph to build on. Warm paths need the founder's private history, which lives in our graph, not theirs.
2. **"Why pay per lead instead of a subscription?"** Founders hate paying $185/mo for credits they do not use. Per verified lead
   means they pay only when we prove something; it is also the easiest number to compare against an SDR ($0 vs. $1 per lead).
3. **"Is the market big enough?"** Sales intelligence is $4.4B now and growing 13%/yr; Clay alone is $100M ARR. Our founder wedge
   is ~$90M/yr on our assumptions, and the same product sells to SDR teams next.
4. **"What about deliverability and spam law?"** Nothing sends without a human approving in the HITL queue; messages cite a public
   signal, so volume stays low and relevant. LinkedIn is copy-to-clipboard, never an unofficial API.
5. **"What is real today and what is not?"** Real: cited discovery with a live validator, Kùzu graph with warm-path Cypher,
   Flexprice metering and gate, Band agents with human approval, deployed on Tenki. Not yet: real LinkedIn graph import, the
   displacement query, and a cost-per-lead benchmark against Clay (all post-hackathon).
