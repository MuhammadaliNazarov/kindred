# Kindred: 2:30 demo script

App: https://e6ohax5xwx6jbzz5mu2pjvx3v2zkimtq--u6faat.us.sb.tenki.sh · Code: https://github.com/AliNazaarov/kindred

## The product in one breath

Kindred is an AI sales team for a startup. You describe your product. It works out who to sell to and finds real companies
that need it right now. It also finds who you know that can introduce you, and writes the first messages. Every claim links
to the web page it came from, and nothing is sent until a human approves it.

**One line:** "Clay finds leads. Kindred tells you *why now* and *who can introduce you*, and proves every claim."

**Why it matters:** AI sales tools today spam people with made-up facts (11x, Apollo complaints) or burn credits unpredictably
(Clay). Kindred only says what it can prove, shows the cost per verified lead, and keeps a human in charge.

## Before you record (5 min)

1. Reset the demo: `curl -X POST https://warmpath-api--u6faat.us.sb.tenki.sh/reset`
2. Open the app at full width (1440 px or more) and close other tabs.
3. If Band is set up, open the `warmpath-demo` room in a second window, side by side.
4. Do one practice run without recording.

## Script (say the bold lines; do what's in brackets)

**0:00–0:15 · Hook** [on Intake]
> "Every AI sales tool can find 10,000 leads. None can tell you *why now*, *who can introduce you*, or prove a single claim.
> Kindred does all three. Today we're selling Tenki, the sandbox company."

**0:15–0:35 · Intake → ICP** [click "Use Tenki demo" → "Generate ICP"]
> "I describe the product in plain words. The agent fills in the rest, including my own past employers, for warm intros.
> It works out who to sell to: industries, buyer titles, buying triggers. Each one has a confidence score and a source."
[Hover a source chip. Click **Accept** on one expansion segment.]
> "It also suggests markets I hadn't thought of. I stay in control: accept, adjust or dismiss."

**0:35–1:05 · Discovery: the receipts** [go to Discovery, click an A-tier company]
> "These are real companies, each with a buying signal, like a job post or funding round, scored 0 to 100."
[Click a source chip → the real page opens.]
> "Every claim links to the page it came from. Watch Agent Thinking:"
[Point at the red line "Dropped: quote not found".]
> "When the agent can't prove a claim, it drops it. No hallucinated leads."

**1:05–1:25 · Graph: who introduces you** [the graph pane on the right]
> "This is our knowledge graph. It found a path: I worked with someone who now works with this buyer. That's a warm intro,
> taken from my real history. Here's the graph query it ran." [point at the Cypher]

**1:25–1:50 · Credits (Flexprice)** [click **Verify & enrich** on 2–3 buyers]
> "Finding and verifying a contact costs credits, metered with Flexprice. You see the cost per verified lead up top."
[Keep clicking until it blocks.]
> "When credits run out, enrichment stops automatically. No surprise bills."

**1:50–2:15 · Human approval (Band agents)** [go to Outreach; Band room beside it if live]
> "Four agents work as a team in Band: Planner, Builder, Reviewer and Security. Reviewer checked every claim against its source,
> and Security checked the links. But nothing goes out until a human says so."
[Type `@Security approve` in Band, or click **Approve** in the queue.]
> "Approved, and sent to our test inbox, never to a real prospect during the demo."

**2:15–2:30 · Pipeline + learning** [go to Pipeline, drag a card to Replied, click **Simulate 300 sends**]
> "Every lead moves through the pipeline, and we always know whether the AI or a person moved it. And it learns: each reply
> is a reward, and traffic shifts to the message that works."
**Close:** "Kindred: every claim cited, every intro warm, every lead priced. Built on Tenki, Band, Flexprice and Tavily."

## If something isn't live yet

- **Band not set up:** show the Outreach approval queue. Say "Reviewer and Security agents checked these" (their verdicts are on each card).
  Optionally run `cd api/band_agents && uv run python agents.py all --dry-run` in a terminal to show the @mention handoffs.
- **Flexprice not set up:** the credit block still works on our own built-in credit ledger. Say "metered per event, Flexprice-ready".
- **The page loads slowly:** wait. Every screen falls back to cached demo data.

## Likely judge questions

- *Are the leads real?* Discovery searches the live web with Tavily, and the validator drops any claim whose quote isn't on its page.
  The sample rows are labelled "sample".
- *Do you send email automatically?* Never. A human approves each message, and during the demo mail only goes to our own inbox.
- *How do you make money?* Per verified lead, metered by Flexprice, so customers pay for proof, not volume.
- *Where's the AI?* Claude does the ICP and the copy. Four Band agents coordinate. A Thompson-sampling bandit learns from replies, and
  the same verifier that gates copy is the reward for training a small copy model with GRPO (code in `api/rl/`).
