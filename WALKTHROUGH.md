# Kindred: your walkthrough + 2:30 video script

**App:** https://e6ohax5xwx6jbzz5mu2pjvx3v2zkimtq--u6faat.us.sb.tenki.sh · **Code:** https://github.com/AliNazaarov/warmpath
**Event:** Post-Training & RL Buildathon. The judges care most about how a model or agent got better through training.

## 1. Kindred in one breath

Kindred is an AI sales agent for startups. You describe your product. It works out who should buy it and finds real companies
showing a buying signal right now, like a job post or funding round. It shows who in your network can introduce you and writes
the outreach. **Every claim links to its source, and a human approves before anything is sent.**
**It also gets better from use:** every human decision becomes training data, and the checker that guards every message is the
same reward we train the model on.

**One line:** "Clay finds leads. Kindred tells you why now and who can introduce you, proves every claim, and learns from every approval."

## 2. What we built (6 screens)

| Screen | What it does | Real or sample |
|---|---|---|
| **Intake** | Chat plus a form: you describe the product, and the agent asks what's missing | Real |
| **ICP** | Who to sell to: industries, buyer roles, triggers, each with a confidence score and real source links. Plus "expansion segments" you accept, adjust or dismiss | Real web sources (Tavily) |
| **Discovery** | Real companies found on the live web (job posts, funding news), scored 0–100 with tier A/B/C. The source chip opens the page; claims that couldn't be proven are dropped. A graph shows warm intro paths | Real companies; warm paths are **sample** (they need your real network) |
| **Outreach** | 3-touch email/LinkedIn drafts per lead. Reviewer and Security verdicts on each one. **Approve / Edit / Reject**; nothing sends without approval | Drafts are templates without live Claude in the cloud; sends go to a test inbox only |
| **Pipeline** | Kanban (Matched → Contacted → Replied → Meeting → Closed), with AI-vs-human attribution on every move. Analytics, an A/B test, an audit log, and the **learning loop** (bandit) | Real |
| **Model · RL** | Post-training: preference data from human edits, the RL environment you can try, the training curve, and the base-vs-trained eval | Real training run (CPU) |

**Sponsors used:**
- **Tenki:** hosts the app, the API and the RL environment.
- **Band:** 4 agents (Planner, Builder, Reviewer, Security) work in a shared room and hand off with @mentions; Security asks a human to approve.
- **Flexprice:** meters 3 events (leads enriched, outreach sent, graph queries) against a prepaid wallet, and blocks enrichment when credits run out.
- **Tavily:** live, cited web search.
- **Hunter:** email verification.
- **Snyk:** a security scan workflow in the repo.

## 3. The RL story (what makes judges care)

| Buildathon theme | Kindred's piece |
|---|---|
| **Reward modelling (RLVR)** | A rule-based **verifier** scores every draft: it cites the signal, names the company, has no outcome guarantees, links only to allowed domains, ends with a question, and has the right length. It gates the human review queue. |
| **RL environment** | `OutreachEnv`: `reset()` gives a real lead and its cited signal, and `step(draft)` returns the verifier's reward. Served over HTTP (`/env/reset`, `/env/step`) from Tenki, so anyone can train on it. |
| **Preference data (DPO / RLHF)** | Every **Edit** in the queue becomes a pair (rejected = AI draft, chosen = human edit). Every **Reject** pairs with a better draft. Download it as JSONL from the Model tab. |
| **Fine-tuning (GRPO + LoRA)** | We trained a small open model (SmolLM2-135M) with GRPO on CPU: 4 drafts per lead, scored by the verifier, and the model pushed toward drafts above the group average. |
| **Evals** | Base vs trained on held-out leads: average reward, citation rate, no banned claims, length, ends with a question. See the Model tab. |
| **Learned inference-time policy** | A Thompson-sampling **bandit** moves outreach traffic to the message style that gets replies (Pipeline → Learning loop). |

**The insight to say out loud:** "The checker that protects every outgoing message *is* the reward we train on, and every human
edit becomes preference data. So the product gets better just by being used."

**Eval result (real run, 30 Oct):** SmolLM2-135M, GRPO + LoRA, 25 steps on CPU, evaluated on 20 held-out leads.

| Metric | Base | Trained |
|---|---|---|
| Average reward (0–1) | 0.663 | **0.681** |
| Length within limits | 55% | **60%** |
| Cites the signal | 100% | 100% |
| No banned claims | 95% | 95% |
| Ends with a question | 0% | 0% |

**Say it honestly:** "A small, real improvement after 25 steps on a CPU. The point is the loop: the same reward, the same environment
and the preference data scale to a bigger model on a GPU." The weak spot is that no draft ends with a question, which is the
obvious next reward to push. Don't claim a big jump.

**Where it ran:** training started on a Tenki CPU sandbox, but that sandbox ran out of memory during the eval and was shut down. The final
run was on the laptop CPU. Tenki hosts the app, the API and the RL environment.

## 4. Before you record (5 min)

1. Open the app in Chrome at full width (1440 px or more).
2. Open app.band.ai in a second window: the `warmpath-demo` room with Planner, Builder, Reviewer and Security.
3. Practise one run without recording. Drag one Kanban card by hand.
4. Don't enrich a company with no website (the grid shows it as "—").

## 5. The 2:30 script (say the bold lines, do what's in brackets)

**0:00–0:15 · Hook** [Intake screen]
**"AI sales tools find thousands of leads but can't prove a single claim, and they never learn. Kindred proves every claim and gets better
every time you approve a message. I'm selling Tenki today."**

**0:15–0:35 · Intake → ICP** [Use Tenki demo → Generate ICP → hover a source chip → Accept one expansion]
**"I describe the product. Kindred works out who buys, and every point has a confidence score and a real source. It suggests markets I
missed; I stay in control."**

**0:35–1:00 · Discovery** [Discovery → click a top company → click its source chip → point at a red "Dropped" line in Agent Thinking]
**"These are real companies found on the live web, each with a buying signal like a job post or funding. Every claim links to the page
it came from, and when the agent can't prove something, it drops it."** [Click **Verify & enrich** on one.] **"Verifying a contact
costs credits, metered by Flexprice. Out of credits, it stops."**

**1:00–1:30 · Human in the loop + Band** [Outreach → show the Reviewer/Security verdicts → Band room window]
**"Four agents work as a team in Band: Planner, Builder, Reviewer, Security. Reviewer checks every claim against its source, Security checks
the links. Nothing is sent until a human approves."** [Click **Edit**, change a line, Save, then **Approve**.] **"And that edit just became
training data."**

**1:30–2:15 · Model · RL (the money shot)** [Model tab]
**"Here's the post-training. Each human edit becomes a preference pair. The checker that guards every message is our reward function.
We wrapped it as an RL environment."** [Try it: Reset, paste a bad draft, Step, and show the low reward and ✗ checks.] **"Then we trained a
small open model with GRPO, on a CPU, in 25 steps."** [Point at the reward curve, then the base-vs-trained bars.] **"On held-out leads,
the trained model already scores higher than the base. Same loop, bigger model, bigger gain."**

**2:15–2:30 · Close** [Pipeline → Learning loop → Simulate]
**"And live, a bandit shifts traffic to the messages that get replies. Kindred: every claim cited, every intro warm, and better with every
approval. Built on Tenki, Band, Flexprice and Tavily."**

## 6. Judge questions

- **Is the training real?** Yes. GRPO with LoRA on SmolLM2-135M, 25 steps on CPU (the Tenki attempt ran out of memory, so the final run was on the laptop). The reward curve and the eval are from
  that run. It's small, because it's a one-day CPU run; the same scripts scale to Qwen 0.5–1.5B on a GPU (`api/rl/README.md`).
- **Why a rule-based reward, not a learned reward model?** It's verifiable (RLVR): it can't be fooled by tone, and the same function is the
  production quality gate. A length cap and banned-claim penalties limit reward hacking. Next step: a learned reward model on the human
  preference pairs.
- **Are the leads real?** Yes: live Tavily search, and the quote is checked on the page. Warm paths use sample data until you connect
  your real network.
- **Do you send email automatically?** Never. A human approves each one, and demo sends go only to our own inbox.
- **Business model?** Pay per verified lead, metered with Flexprice, so customers pay for proof, not volume.
