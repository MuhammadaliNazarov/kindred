# Kindred: your 2:30 video script (click by click)

**Story spine:**
1. **Problem:** AI sales tools send thousands of emails full of made-up facts, and nobody checks them.
2. **Insight:** If code can check a claim, that same check can be the reward that trains the model.
3. **Proof:** Kindred drops any claim whose quote isn't on the source page, gates every email with that checker, and GRPO on that reward raised held-out reward (0.658 → 0.675), while per-check evals caught reward hacking in run 2.

**15-second elevator version:**

> "AI sales tools invent facts. Kindred only says what it can prove: every claim links to its source, or it's dropped. The checker that blocks bad emails is also our RL reward, so every human review trains the model."

**Open before recording:**
- Chrome, full screen: https://kindred-sable-gamma.vercel.app
- A second tab: https://app.band.ai → room **kindred-demo**
- Optional third tab: the GitHub repo

**The one sentence to remember:**

> "Kindred only says what it can prove, and the checker that keeps it honest is the same reward we train the model on."

*Pace: about 2.5 words a second. Each beat's lines fit its time box; pause on the clicks, not mid-sentence.*

---

## 0:00–0:15 · Hook (face on camera, or on the Intake page)
**Say:** "AI sales tools send thousands of emails full of made-up facts. **Kindred** is different. It only says what it can prove, finds who can introduce you, and **every human review trains the model with reinforcement learning**."

## 0:15–0:35 · Intake → ICP (covers *ICP & Discovery, 20%*)
**Click:** **Use Tenki demo** (top right), then **Generate ICP**.
**Say:** "I tell Kindred what I sell. Here, that's Tenki. It reads the website, LinkedIn and socials, fills in the profile, and flags gaps in red. Then it builds the ICP: industries, buyer titles, buying triggers, **each with a confidence score and a source link**."
**Click:** hover one **source chip**, then click **Accept** on one *expansion segment*.
**Say:** "It suggests new markets too. I decide which ones."

## 0:35–1:00 · Discovery: proof, not guesses
**Click:** **3 · Discovery**, then the **top A-tier company**.
**Say:** "These are real companies Kindred found on the live web with Tavily, scored 0 to 100 on fit and intent. **Every claim links to the page it came from.**"
**Click:** a **source chip**, so the real page opens. Then open **Agent Thinking** (top right) and point at a red **"Dropped: quote not found"** line.
**Say:** "Watch this. If the quote isn't on the page, Kindred **drops the claim**. Code checks the proof. No model guessing."
**Point at the graph pane:** "This knowledge graph searches my network for a **warm intro** to the buyer. Here's the exact query it ran."

## 1:00–1:15 · Credits: usage billing (covers *Flexprice, +20*)
**Click:** **Verify & enrich** on 2–3 buyers.
**Say:** "Verifying a contact costs credits, metered live in **Flexprice**. The header shows the cost per verified lead. When credits hit zero, enrichment stops by itself. You pay for proof, not volume."

## 1:15–1:45 · Human approval and the agents (covers *Enrichment & Outreach, 20%* and *Band, +20*)
**Click:** **4 · Outreach**.
**Say:** "Every email congratulates them on a real signal, speaks to their problem, and signs off with my name and role. A **Reviewer** agent checks every claim. A **Security** agent checks every link. **Nothing is sent without a human.**"
**Click:** **Edit** one draft (shorten it, end with a question), then **Save**. Then **Approve** another.
**Say:** "And my edit doesn't just fix this email. **It becomes training data.**"
**Switch to the Band tab** (room *kindred-demo*). Type `@Planner Find 5 Tier-A buyers for Tenki and draft outreach` and let it run for a few seconds.
**Say:** "Four agents, Planner, Builder, Reviewer and Security, hand off work in Band with @mentions. And Security asks **me** before anything goes out." Then type `@Security approve`.

## 1:45–2:00 · Pipeline (covers *Dashboard, 15%*)
**Click:** **5 · Pipeline**. Drag one card from **Contacted** to **Replied**.
**Say:** "Every lead moves through the pipeline, and we log whether **the AI or a person** moved it. Conversion by industry and tier, an audit log, and a **bandit** that sends more traffic to the message style that gets replies."

## 2:00–2:25 · Reinforcement learning, the core (the room's theme)
**Click:** **6 · Learning** (Model · RL).
**Say:**
- "Here's why this isn't a wrapper. The checker that gates every email is our **RL reward**. We built the **environment**: `reset()` gives a real lead, `step(draft)` scores the email."
- "We trained a small open model with **GRPO on Tenki**. On 30 leads it never saw, the reward went up."
- "Pushed harder, it **reward-hacked**: score up, citations down. Our per-check evals caught it, so we kept the safe run."
- "And my edits became **DPO preference pairs**. My style notes became **new reward rules**."

## 2:25–2:30 · Close
**Say:** "**Kindred: every claim proven, and every human review makes the next model better.**"

---

## How RL fits (for Q&A)
| Concept | In Kindred |
|---|---|
| Environment | `POST /env/reset` gives a lead and its cited signal; `POST /env/step {draft}` gives the reward and per-check results |
| Reward (RLVR) | Verifier, max 5.5: company named, signal cited, question CTA, 30–90 words, every claim sourced, congratulations opener, name and role sign-off; penalties for guarantees and bad links |
| GRPO | 4 drafts per lead, score them, push toward the above-average ones (SmolLM2-135M + LoRA, Tenki CPUs) |
| DPO | Human edits and rejects as preference pairs (4 human + 19 verifier pairs) |
| Eval | 30 held-out leads; base 0.658 → GRPO run 1 0.675, no regressions |
| Reward hacking | Run 2 reached 0.683 but citations fell 100→90% and clean claims 96.7→86.7%, caught per check |
| Harbor | 20 tasks in Harbor format, so any agent or trainer can use our environment |
| Inference-time RL | A Thompson-sampling bandit over message styles, with replies as the reward |

## The debugging story (judges like this)
1. **Hallucinated leads:** we added a validator that fetches every source page; claims whose quote isn't there are dropped.
2. **Reward hacking:** GRPO run 2 gamed length at the cost of citations; we caught it with per-check evals and kept run 1.
3. **Memory limits:** the 360M model crashed an 8 GB Tenki sandbox, so we moved to 135M and it ran stably.
4. **DPO side effect:** with only 4 human pairs it slightly regressed on banned claims, so the verifier stays a hard gate and more reviews fix it.
5. **Big sites block scrapers:** for sites like zara.com, Kindred falls back to web search and flags missing fields in red for the user.

## Likely questions
- **"Is this just a Claude wrapper?"** "No. Claude is one part. We built the RL environment, the reward and a Harbor dataset, trained our own model on that reward, and code, not a model, proves every claim."
- **"Does it send email automatically?"** "Never. A human approves every message."
- **"How do you make money?"** "Per verified lead, metered by Flexprice. You pay for proof, not volume."
- **"Why is the model so small?"** "It's a 135M model, trained on CPUs in one day. The loop is the product. With a GPU and more reviews, it scales."

**Links to submit:**
- App: https://kindred-sable-gamma.vercel.app
- Code: https://github.com/MuhammadaliNazarov/kindred
- Design doc: ARCHITECTURE.md in the repo
