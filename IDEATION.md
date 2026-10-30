# Warmpath ideation: merged decisions (30 Oct)

This file merges three reviews: product-lens, market-research and council. Read DESIGN.md first. Every item below either takes
under 30 minutes or is marked post-hackathon. No code was changed while writing this.

## Positioning line

> **Clay finds leads. Warmpath tells you why now and who introduces you, and proves every claim.**

Short version for the header and README: "Every AI SDR guesses. Warmpath shows its receipts."

Who pays: a seed to Series A founder who still does the selling (no AE hired yet), selling B2B at a $5-50k ACV. It replaces Clay
and Apollo seats, hunting for mutual connections by hand, and an SDR agency on retainer.

## Decisions to apply now (6)

| # | Decision | DESIGN.md section it changes | Time |
|---|---|---|---|
| 1 | **Make the warm path real.** Add one Intake field for the founder's past employers and schools (a LinkedIn connections CSV upload is optional) and write it as `(me)-[:previously_employed_at]->(Company)`. Use a seeded "me" when the field is empty. In the demo, say: "this path comes from your history, not a guess." | §3 step 1 (Intake), §5 query 1 | 25 min |
| 2 | **Cut the displacement query** (graph query 3, `uses` edges plus churn signals). It is the likeliest live hallucination and can't be cited from public data in the time left. Remove it from the §3 graph pane and from §5. Spend the time on decision 1 and the hiring signal. | §3 step 3, §5 query 3 | saves time |
| 3 | **Show a rejected claim live.** Seed one discovery claim whose quote doesn't appear at its URL. Agent Thinking then shows "dropped: quote not found at source". Also make the citation chip open the real page with the quote highlighted (or scrolled into view). | §3 step 3, §4 no-hallucination rule | 20 min |
| 4 | **Price per verified lead.** Rename the meter `lead_enriched` to `lead_verified` and fire it after the validator passes. Show a "$ per lead" chip in the header, using the real meter value, not a hardcoded $0.04. Set the demo wallet to 3 credits so the enrichment gate blocks on camera. | §1 Flexprice row, §1 viability row, §3 step 5 | 15 min |
| 5 | **Label or cut the 80% / 5% stat.** Either remove it or mark it "vendor-reported (Unify)". A judge will ask where it came from. | §2 bullet 1 | 5 min |
| 6 | **Set up the demo for movement.** Keep the Band room open in a split pane during the Outreach beat, and send one reply from our test inbox live so a card moves Contacted → Replied, tagged "AI". Show Intake and ICP briefly, but keep the confidence bars and one accepted expansion segment, since ICP is 20% of the score. | §3 steps 1, 2, 4, 5; §8 row 3:45-4:30 | 20 min |

## Timed demo script (2:45)

| Time | Beat | What has to be on screen |
|---|---|---|
| 0:00-0:12 | Hook: say the positioning line. | Header showing the $/lead chip and credits |
| 0:12-0:30 | Intake: paste tenki.dev. The agent asks one question and the form fills itself, including the "my past employers" field. | Form filling live |
| 0:30-0:50 | ICP cards with confidence bars. Accept one expansion segment and click its evidence link. | Confidence bars, source opens |
| 0:50-1:20 | Discovery grid: open an A-tier lead and its job-post signal, then click the source chip to show the quote on the page. Agent Thinking shows one claim dropped. | Receipts moment, red "dropped" line |
| 1:20-1:45 | Graph pane: the warm-path Cypher runs and the 2-hop intro lights up. Say "from your history, not a guess." | Cypher shown, path highlighted |
| 1:45-2:10 | Outreach queue with the Band room in split view. Reviewer and Security sign off, the human types "approve", and the mail arrives in our inbox. | Band @mentions, HITL approve |
| 2:10-2:25 | Click Enrich on the next lead. Credits reach 0 and Flexprice blocks it. Top up and it runs. | Gate block, then success |
| 2:25-2:40 | Reply from the test inbox. The card moves to Replied (AI). Show A/B by variant and the audit log. | Kanban card moving |
| 2:40-2:45 | Close: Snyk badge, Tenki preview URL, "every claim cited, priced per verified lead." | README badge, URL |

## Competitive context (for the README / Q&A)

| Product | Wedge | Top complaint (secondhand, often from competitor blogs) |
|---|---|---|
| Clay | Waterfall enrichment + AI columns | Unpredictable credit spend, wrong phone data |
| Unify | "Warm outbound" intent plays | Expensive. Email-first and US tech only |
| Origami Agents | Live-web research agents | Too new to judge |
| Rox | Agents on a revenue graph for AE teams | Opaque pricing |
| 11x (Alice) | Fully autonomous AI SDR | Hurts deliverability, acts on bad data, high reported churn |
| Apollo | Big database + sequences | "Inaccurate data" is the top G2 complaint |

The gaps Warmpath claims:
- **Every claim has a source.** We drop any claim we can't verify, and a human approves before anything is sent. This answers
  11x and Apollo.
- **Warm intro paths, with the cost per lead shown up front.** This answers Clay's and Unify's unpredictable credit costs.

Prices in the source report are estimates. Check each vendor's own pricing page before quoting them.

## Post-hackathon

- Rebuild the displacement query properly, with real `uses` edges and cited churn signals.
- Benchmark cost per lead against Clay for real.
- Test pricing with 5 founders: per verified lead vs. per-seat subscription.
- Migrate to Neo4j (Kùzu stays for the demo), add the LinkedIn channel, tune the reply classifier on real replies.
- Import the full LinkedIn connections graph for warm paths (beyond the single intake field).
- Gather first-hand user complaints from Reddit and X. The current ones are secondhand.
