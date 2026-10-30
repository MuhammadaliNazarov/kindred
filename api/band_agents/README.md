# WarmPath Band room — Planner · Builder · Reviewer · Security · you

Four Band remote agents collaborate in one room with a human. They drive the WarmPath API
(`api/app`) through allow-listed tools and hand off with @mentions. **Nothing is sent and no
schema changes unless a human types `approve` in the room** — enforced in code, not prompts.

```
Human ──@Planner──▶ Planner (intake, discover, leads, credits)
                      └─@Builder──▶ Builder (enrich → 402 = "Enrichment paused — out of credits (Flexprice)", draft)
                                       └─@Reviewer──▶ Reviewer (touches: claims vs cited sources → pass/fix/fail)
                                                          └─@Security──▶ Security (links, domains, PII → pass/fail)
                                                                             └─@you: "Approve sending N messages? Reply 'approve' or 'reject'"
you: approve ──▶ Security.approvetouches (gate checks YOUR last message) ──▶ POST /touches/{id}/review action=approve
you send from the Outreach queue in the UI (POST /touches/{id}/send is unreachable from any agent)
```

Every agent also posts a `usage · <role>: N in / M out tokens · ≈$x` line per turn and emits Band
`Emit.USAGE` events, so the room and dashboard show cost.

## Files

| File | What |
|---|---|
| `agents.py` | All four agents, tools, HITL gate, dry-run simulator |
| `run_all.sh` | `uv run python agents.py all` (or pass `--dry-run`) |
| `.env.example` | Env vars to fill in |
| `pyproject.toml` | Own uv project: `band-sdk[anthropic]`, `httpx`, `python-dotenv` |

## Setup (what the human does)

1. **Backend up:** `cd api && uv run uvicorn app.main:app --port 8000` → `curl localhost:8000/health`.
2. **Create 4 remote agents in the Band UI** (app.band.ai → Agents → *New remote agent*). Name them exactly
   `Planner`, `Builder`, `Reviewer`, `Security` (the prompts @mention by these names). Copy each one's
   **Agent ID** and **API key**.
3. **Env:** `cd api/band_agents && cp .env.example .env`, paste the 4 ID/key pairs plus `ANTHROPIC_API_KEY`.
   `CLAUDE_MODEL` defaults to `claude-sonnet-5-5` (DESIGN §6); `WARMPATH_API` defaults to `http://localhost:8000`.
4. **Install + run:** `uv sync && ./run_all.sh` (or `uv run python agents.py planner` etc. in 4 terminals).
   Wait for four "Connected to platform" lines.
5. **Room:** in Band create a chatroom **`warmpath-demo`**, add all four agents from the participants panel, and
   yourself.
6. **Demo prompt — paste in the room:**

   > @Planner Find 10 Tier-A buyers for Tenki and draft outreach

7. **What should happen** (≈1–2 min):
   - Planner posts a milestone plan + lead ids + credit balance, @mentions **Builder**.
   - Builder enriches + drafts each lead, reports email status and touch ids, @mentions **Reviewer**.
     If the Flexprice wallet is empty it posts `Enrichment paused — out of credits (Flexprice)` and asks you
     (`POST /credits/reset` in the API refills; then say "@Builder continue").
   - Reviewer posts pass / fix / fail per touch (claims vs cited quote + URL), @mentions **Security**.
   - Security posts link/domain/PII verdicts, then @mentions **you**: *Approve sending N messages? Reply 'approve' or 'reject'.*
   - **You reply `@Security approve`** → the gate verifies the latest human message, touches become `approved`
     in the Outreach queue (`GET /touches`, `GET /audit` shows `rep approve`). Reply `reject` and it refuses.
   - You click **Send** in the Outreach queue. Agents cannot: `/touches/{id}/send` is in `FORBIDDEN`.
   - Each agent's `usage ·` line shows tokens and ≈$.

## The HITL rule, in code

- `FORBIDDEN` regexes in `api()` block `/touches/{id}/send` and anything matching `send`/`schema`/graph DDL for every
  agent, before any HTTP request is made.
- `ALLOWED[role]` is a per-agent allow-list of (method, path); anything else raises `HITLError`.
- `approvetouches` calls `require_human_approval(room_id)`: the **latest message in the room from a participant whose
  `sender_type != "Agent"`** must contain `approve` (and not `reject`). The adapter records those messages as they
  arrive (`WarmPathAdapter.on_message`); the model never gets to assert approval itself.
- Review/approve only marks drafts approved; sending stays with the human in the UI.

## Dry run (no Band or Anthropic keys)

```
./run_all.sh --dry-run                      # uses localhost:8000 if up, else an in-process stub
./run_all.sh --dry-run --out-of-credits     # shows the Flexprice 402 pause (stub only)
```

It calls the same tool handlers in the same order, prints every @mention handoff, shows Security being refused
before the human answers (and refused on `/send`), then the human's `approve` releasing the review.
