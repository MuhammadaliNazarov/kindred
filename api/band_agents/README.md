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
| `pyproject.toml` | Own uv project: `band-sdk[anthropic,claude-sdk]`, `httpx`, `python-dotenv` |

## Setup (what the human does)

1. **Backend up:** `cd api && uv run uvicorn app.main:app --port 8000` → `curl localhost:8000/health`.
2. **Create 4 remote agents in the Band UI** (app.band.ai → Agents → *New remote agent*). Name them exactly
   `Planner`, `Builder`, `Reviewer`, `Security` (the prompts @mention by these names). Copy each one's
   **Agent ID** and **API key**.
3. **Env:** `cd api/band_agents && cp .env.example .env`, paste the 4 ID/key pairs. No `ANTHROPIC_API_KEY` needed:
   with it empty the agents run on your Claude subscription (see *LLM backend* below). `WARMPATH_API` defaults to
   `http://localhost:8000`.
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

## LLM backend: Claude subscription or API key

`BAND_LLM` picks the band-sdk adapter (same 4 roles, prompts, tools and HITL gate either way):

| `BAND_LLM` | Adapter | Auth |
|---|---|---|
| `claude_sdk` (default when `ANTHROPIC_API_KEY` is empty) | `ClaudeSDKAdapter` → Claude Agent SDK → `claude` CLI | the Claude Code login on this machine, or `CLAUDE_CODE_OAUTH_TOKEN` |
| `anthropic` (default when `ANTHROPIC_API_KEY` is set) | `AnthropicAdapter` | `ANTHROPIC_API_KEY`, model `CLAUDE_MODEL` |

With `claude_sdk` the model is `CLAUDE_SDK_MODEL` (default `sonnet`), `permission_mode=dontAsk` so only Band's tools and
our allow-listed custom tools can run (no Bash/Write/WebFetch), and no `~/.claude` settings are loaded.

**On your Mac:** be logged into Claude Code (`claude` → `/login`). Nothing else.

**On a server (Tenki sandbox), no browser login there:**

```bash
# on the Mac, once: creates a long-lived (1 year) subscription token and prints it
claude setup-token
# in the sandbox
npm i -g @anthropic-ai/claude-code            # the Agent SDK drives this CLI
export CLAUDE_CODE_OAUTH_TOKEN=<token from setup-token>   # set it as a sandbox secret/env var, not in git
unset ANTHROPIC_API_KEY                       # or leave it empty; BAND_LLM=claude_sdk also forces it
claude -p "say ok" --output-format json       # sanity check
./run_all.sh
```

This spends **your Claude subscription's usage limits** (four agents share them) and is meant for personal/dev use
like this demo, not for serving other users; for anything shared or production use an API key (`BAND_LLM=anthropic`).
The `usage ·` line still shows a list-price ≈$ figure, marked as billed to the subscription.

## The HITL rule, in code

- `FORBIDDEN` regexes in `api()` block `/touches/{id}/send` and anything matching `send`/`schema`/graph DDL for every
  agent, before any HTTP request is made.
- `ALLOWED[role]` is a per-agent allow-list of (method, path); anything else raises `HITLError`.
- `approvetouches` calls `require_human_approval(room_id)`: the **latest message in the room from a participant whose
  `sender_type != "Agent"`** must contain `approve` (and not `reject`). The adapter records those messages as they
  arrive (`WarmPathAdapter.on_turn`); the model never gets to assert approval itself. (ClaudeSDKAdapter runs custom
  tools in its local MCP server, so the gate reads the room from `ACTIVE_ROOM`, set by `on_turn`.)
- Review/approve only marks drafts approved; sending stays with the human in the UI.

## Dry run (no Band or Anthropic keys)

```
./run_all.sh --dry-run                      # uses localhost:8000 if up, else an in-process stub
./run_all.sh --dry-run --out-of-credits     # shows the Flexprice 402 pause (stub only)
```

It calls the same tool handlers in the same order, prints every @mention handoff, shows Security being refused
before the human answers (and refused on `/send`), then the human's `approve` releasing the review.
