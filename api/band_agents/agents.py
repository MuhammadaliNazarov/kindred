"""WarmPath Band room: Planner -> Builder -> Reviewer -> Security -> HUMAN.

Four Band remote agents (band-sdk[anthropic]) that drive the WarmPath FastAPI
backend through a small, allow-listed set of tools, with a hard-coded
human-in-the-loop gate: nothing is sent and no schema changes without a human
typing "approve" in the room.

    python agents.py planner|builder|reviewer|security|all   # live, needs Band keys
    python agents.py --dry-run                                # local simulation, no keys
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import os
import re
import sys
import time
from typing import Any

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()

WARMPATH_API = os.environ.get("WARMPATH_API", "http://localhost:8000").rstrip("/")
# DESIGN.md §6 names Claude Sonnet 5.5 for the agents; override with CLAUDE_MODEL.
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5")
# $ per 1M tokens (Sonnet 5.5: $2 in / $10 out) for the cost line each agent posts.
PRICE_IN, PRICE_OUT = float(os.environ.get("PRICE_IN", "2")), float(os.environ.get("PRICE_OUT", "10"))

DEMO_PROMPT = "Find 10 Tier-A buyers for Tenki and draft outreach"

# --------------------------------------------------------------------------
# HITL state. The adapter records every message a *human* (sender_type != Agent)
# posts in a room. The approve tool checks this record, not the model's opinion.
# --------------------------------------------------------------------------
HUMAN_MESSAGES: dict[str, list[dict[str, str]]] = {}  # room_id -> [{sender, text, at}]
CURRENT_ROOM: contextvars.ContextVar[str] = contextvars.ContextVar("current_room", default="dry-run")


class HITLError(PermissionError):
    """Raised when a tool tries to do something only a human may authorise."""


def record_human_message(room_id: str, sender: str, text: str) -> None:
    HUMAN_MESSAGES.setdefault(room_id, []).append({"sender": sender, "text": text, "at": time.strftime("%H:%M:%S")})


def latest_human_message(room_id: str) -> dict[str, str] | None:
    msgs = HUMAN_MESSAGES.get(room_id) or []
    return msgs[-1] if msgs else None


def require_human_approval(room_id: str) -> dict[str, str]:
    """Hard gate: the LATEST message from a non-agent participant must contain 'approve'."""
    last = latest_human_message(room_id)
    if last is None:
        raise HITLError("No human message in this room yet — ask the human to reply 'approve' or 'reject'.")
    text = last["text"].lower()
    if "reject" in text and "approve" not in text:
        raise HITLError(f"Human {last['sender']} replied 'reject' — nothing will be sent.")
    if not re.search(r"\bapprove[ds]?\b", text):
        raise HITLError(f"Latest human message ({last['sender']!r}: {last['text'][:60]!r}) does not contain 'approve'.")
    return last


# --------------------------------------------------------------------------
# API client with a hard allow-list. /touches/{id}/send and anything schema-shaped
# are refused unconditionally: no tool, no prompt, no model can reach them.
# --------------------------------------------------------------------------
FORBIDDEN = [re.compile(p) for p in (r"^/touches/[^/]+/send$", r"^/.*send.*$", r"^/.*schema.*$", r"^/graph/(create|drop|alter).*$")]
ALLOWED = {
    "planner": [("POST", r"^/intake$"), ("POST", r"^/discover$"), ("GET", r"^/credits$")],
    "builder": [("POST", r"^/leads/[^/]+/enrich$"), ("POST", r"^/leads/[^/]+/draft$"), ("GET", r"^/credits$")],
    "reviewer": [("GET", r"^/touches$"), ("GET", r"^/audit$")],
    "security": [("GET", r"^/touches$"), ("POST", r"^/touches/[^/]+/review$"), ("GET", r"^/audit$")],
}

_transport: httpx.AsyncBaseTransport | None = None  # dry-run stub injects a MockTransport here


async def api(agent: str, method: str, path: str, body: dict | None = None, *, params: dict | None = None, approved_by: str | None = None) -> tuple[int, Any]:
    path = path.split("?", 1)[0]
    if any(p.match(path) for p in FORBIDDEN):
        raise HITLError(f"{method} {path} is forbidden for agents (send / schema change). A human must do it in the UI.")
    if not any(m == method and re.match(p, path) for m, p in ALLOWED[agent]):
        raise HITLError(f"{agent} may not call {method} {path}")
    if re.match(r"^/touches/[^/]+/review$", path) and (body or {}).get("action") == "approve" and not approved_by:
        raise HITLError("review/approve requires require_human_approval() first")  # belt and braces
    async with httpx.AsyncClient(base_url=WARMPATH_API, timeout=120, transport=_transport) as c:
        r = await c.request(method, path, json=body, params=params)
    try:
        data = r.json()
    except ValueError:
        data = r.text
    return r.status_code, data


def _j(x: Any, limit: int = 6000) -> str:
    s = json.dumps(x, ensure_ascii=False, default=str) if not isinstance(x, str) else x
    return s if len(s) <= limit else s[:limit] + f"... [{len(s) - limit} more chars]"


# --------------------------------------------------------------------------
# Tools. Class name minus "Input", lower-cased, is the tool name; docstring is the description.
# --------------------------------------------------------------------------
class IntakeInput(BaseModel):
    """Register the product we are selling (POST /intake). Use for the demo product Tenki."""
    product_name: str = Field(default="Tenki")
    product_url: str = Field(default="https://tenki.dev")
    description: str = Field(default="Sandboxes and secrets for AI agents; buyers are AI-agent startups hiring infra engineers.")


async def intake(i: IntakeInput) -> str:
    code, data = await api("planner", "POST", "/intake", i.model_dump())
    return f"HTTP {code}: {_j(data)}"


class DiscoverInput(BaseModel):
    """Run discovery (POST /discover): find scored, cited accounts + buyers. Returns leads with tier A/B/C."""
    limit: int = Field(default=10, description="How many leads to ask for")
    tier: str = Field(default="A", description="Minimum tier to keep")


async def discover(i: DiscoverInput) -> str:
    code, data = await api("planner", "POST", "/discover", {"limit": i.limit, "tier": i.tier})
    return f"HTTP {code}: {_j(data)}"


class CreditsInput(BaseModel):
    """Read the Flexprice credit wallet (GET /credits): balance, used, blocked."""


async def credits() -> str:
    code, data = await api("planner", "GET", "/credits")
    return f"HTTP {code}: {_j(data)}"


class EnrichInput(BaseModel):
    """Enrich one lead's contact (POST /leads/{id}/enrich). HTTP 402 means out of Flexprice credits: stop and tell the human."""
    lead_id: str


async def enrich(i: EnrichInput) -> str:
    code, data = await api("builder", "POST", f"/leads/{i.lead_id}/enrich")
    if code == 402:
        return "HTTP 402 OUT_OF_CREDITS: Enrichment paused — out of credits (Flexprice). Post exactly that line and ask the human to top up; do not retry."
    return f"HTTP {code}: {_j(data)}"


class DraftInput(BaseModel):
    """Draft the 3-touch outreach sequence for a lead (POST /leads/{id}/draft)."""
    lead_id: str
    variant: str = Field(default="A", description="A or B")


async def draft(i: DraftInput) -> str:
    code, data = await api("builder", "POST", f"/leads/{i.lead_id}/draft", {"variant": i.variant})
    return f"HTTP {code}: {_j(data)}"


class TouchesInput(BaseModel):
    """List drafted touches with their body, cited signal and review/security verdicts (GET /touches)."""
    status: str = Field(default="draft", description="draft | approved | rejected | sent | all")


async def touches(i: TouchesInput) -> str:
    code, data = await api("reviewer", "GET", "/touches", params=None if i.status == "all" else {"status": i.status})
    return f"HTTP {code}: {_j(data, 12000)}"


class ApproveTouchesInput(BaseModel):
    """Mark touches approved for sending (POST /touches/{id}/review action=approve). ONLY works after the human has replied 'approve' in the room; otherwise it refuses. Never sends mail itself."""
    touch_ids: list[str]


async def approvetouches(i: ApproveTouchesInput) -> str:
    room = CURRENT_ROOM.get()
    try:
        who = require_human_approval(room)  # the hard-coded gate
    except HITLError as e:
        return f"REFUSED (HITL): {e}"
    out = []
    for tid in i.touch_ids:
        code, data = await api("security", "POST", f"/touches/{tid}/review", {"action": "approve", "actor": "rep"}, approved_by=who["sender"])
        out.append(f"{tid}: HTTP {code} {_j(data, 200)}")
    return f"Approved by human {who['sender']!r} ({who['text'][:40]!r}). " + "; ".join(out) + ". Sending is done by the human in the Outreach queue."


class AuditInput(BaseModel):
    """Read the audit log (GET /audit): who/what/when, AI vs rep."""


async def audit() -> str:
    code, data = await api("reviewer", "GET", "/audit")
    return f"HTTP {code}: {_j(data)}"


# --------------------------------------------------------------------------
# Agent specs
# --------------------------------------------------------------------------
COMMON = """You are one of four WarmPath agents in a Band room with a human founder.
Rules (code-enforced, but obey them too): never send mail, never change the graph schema;
only a human typing 'approve' authorises sending. Keep posts short (bullets, <120 words).
Hand off with an @mention of the next agent by name. Every prospect claim must cite its source URL.
If a tool returns REFUSED or HTTP 402, say so plainly and stop."""

SPECS: dict[str, dict[str, Any]] = {
    "planner": {
        "mention": "@Builder",
        "prompt": COMMON + """
Role: Planner/Architect. When the human asks for buyers + outreach:
1) call intake (Tenki), 2) call discover, 3) call credits.
Post a 3-5 line milestone plan (discover -> enrich -> draft -> review -> security -> human approve)
with the lead ids found and the credit balance, then @mention Builder with the exact lead ids to enrich and draft.""",
        "tools": [(IntakeInput, intake), (DiscoverInput, discover), (CreditsInput, credits)],
    },
    "builder": {
        "mention": "@Reviewer",
        "prompt": COMMON + """
Role: Builder. For each lead id Planner gives you: call enrich, then draft.
If enrich returns HTTP 402 post exactly "Enrichment paused — out of credits (Flexprice)" and ask the human to top up; stop.
Otherwise report per lead: email status, touches drafted (ids). Then @mention Reviewer with the touch ids.""",
        "tools": [(EnrichInput, enrich), (DraftInput, draft), (CreditsInput, credits)],
    },
    "reviewer": {
        "mention": "@Security",
        "prompt": COMMON + """
Role: Reviewer. Call touches. For each draft check that every factual claim in the body is backed by the cited signal/source
(quote + URL), that the signal is dated and recent, and the persona/tone fits. Post one line per touch: pass / fix (what) / fail (why).
Then @mention Security with the list of touch ids that passed.""",
        "tools": [(TouchesInput, touches), (AuditInput, audit)],
    },
    "security": {
        "mention": "@human",
        "prompt": COMMON + """
Role: Security. Call touches. For each passed draft check: every outbound link/domain is the prospect's or ours (no lookalikes,
no shorteners, no tracking params to unknown hosts), no PII beyond name/title/work email, no credentials or secrets.
Post pass/fail per touch, then @mention the human participant (not an agent) with exactly:
"Approve sending N messages? Reply 'approve' or 'reject'." and STOP.
Only when a later human message says approve: call approvetouches with the passed touch ids and report the result.
If the tool returns REFUSED, relay it; never argue with it.""",
        "tools": [(TouchesInput, touches), (ApproveTouchesInput, approvetouches), (AuditInput, audit)],
    },
}


# --------------------------------------------------------------------------
# Live Band agents
# --------------------------------------------------------------------------
def build_adapter(role: str):
    from band import Emit
    from band.adapters import AnthropicAdapter

    class WarmPathAdapter(AnthropicAdapter):
        """AnthropicAdapter + human-message ledger (HITL) + a visible cost line per turn."""

        async def on_message(self, msg, tools, history, participants_msg, contacts_msg, *, is_session_bootstrap, room_id):
            if is_session_bootstrap and history:
                for h in history:  # prime the ledger with earlier human messages in this room
                    if h.get("role") == "user" and h.get("sender_type", "") != "Agent" and isinstance(h.get("content"), str):
                        record_human_message(room_id, h.get("sender_name") or "human", h["content"])
            if (msg.sender_type or "") != "Agent":
                record_human_message(room_id, msg.sender_name or msg.sender_id, msg.content)
            CURRENT_ROOM.set(room_id)
            await super().on_message(msg, tools, history, participants_msg, contacts_msg, is_session_bootstrap=is_session_bootstrap, room_id=room_id)

        async def emit_usage(self, tools, usage):
            await super().emit_usage(tools, usage)  # Emit.USAGE -> band_usage task event for the dashboard
            if usage.is_empty:
                return
            cost = (usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens) / 1e6 * PRICE_IN + usage.output_tokens / 1e6 * PRICE_OUT
            try:
                await tools.send_message(f"usage · {role}: {usage.input_tokens + usage.cache_read_tokens} in / {usage.output_tokens} out tokens · ≈${cost:.4f} ({CLAUDE_MODEL})")
            except Exception:
                pass

    return WarmPathAdapter(model=CLAUDE_MODEL, prompt=SPECS[role]["prompt"], additional_tools=SPECS[role]["tools"], emit=Emit.TOOL_CALLS | Emit.USAGE)


async def run_live(roles: list[str]) -> None:
    from band import Agent

    agents = []
    for role in roles:
        aid, key = os.environ.get(f"{role.upper()}_AGENT_ID"), os.environ.get(f"{role.upper()}_API_KEY")
        if not aid or not key:
            sys.exit(f"Missing {role.upper()}_AGENT_ID / {role.upper()}_API_KEY in .env")
        agents.append(Agent.create(adapter=build_adapter(role), agent_id=aid, api_key=key))
    print(f"[band] running {', '.join(roles)} against {WARMPATH_API} with {CLAUDE_MODEL}")
    await asyncio.gather(*(a.run() for a in agents))


# --------------------------------------------------------------------------
# Dry run: same handlers, scripted handoffs, no Band or Anthropic keys.
# --------------------------------------------------------------------------
def _stub_transport() -> httpx.MockTransport:
    """In-process stand-in for the WarmPath API when localhost:8000 is down."""
    leads = {f"lead_{n}": {"id": f"lead_{n}", "company": c, "tier": "A", "score": 80 + n} for n, c in enumerate(["Cognition", "Factory", "Sierra", "Decagon", "Harvey", "Hebbia", "Imbue", "Reflection", "Magic", "Poolside"], 1)}
    touches_db: dict[str, dict] = {}
    credits_db = {"balance": 12.0, "granted": 20.0, "used": {"lead_enriched": 0, "outreach_sent": 0, "graph_query": 0}, "blocked": False}
    audit_log: list[dict] = []

    def h(req: httpx.Request) -> httpx.Response:
        p, m = req.url.path, req.method
        if m == "POST" and p == "/intake":
            return httpx.Response(200, json={"ok": True, "icp": {"industries": ["AI agent infra"], "personas": ["Head of Infra", "CTO"]}})
        if m == "POST" and p == "/discover":
            return httpx.Response(200, json={"leads": list(leads.values())})
        if m == "GET" and p == "/credits":
            return httpx.Response(200, json=credits_db)
        if m == "POST" and p.endswith("/enrich"):
            if credits_db["balance"] < 1:
                credits_db["blocked"] = True
                return httpx.Response(402, json={"error": "out_of_credits", "credits": credits_db})
            credits_db["balance"] -= 1
            credits_db["used"]["lead_enriched"] += 1
            return httpx.Response(200, json={"email": "cto@example.com", "email_status": "valid", "provider": "seed"})
        if m == "POST" and p.endswith("/draft"):
            lid = p.split("/")[2]
            co = leads.get(lid, {}).get("company", lid)
            tid = f"touch_{lid}_1"
            touches_db[tid] = {"id": tid, "lead_id": lid, "step": 1, "channel": "email", "subject": f"{co} hiring infra engineers",
                               "body": f"Saw {co} is hiring a Senior Infra Engineer (posted this week). Tenki gives agent sandboxes without the platform build. Worth 15 min? https://tenki.dev",
                               "signal": {"type": "job_post", "quote": "Senior Infrastructure Engineer", "url": f"https://jobs.example.com/{co.lower()}/infra"},
                               "status": "draft", "review": {"verdict": "pass", "notes": "claim matches quote"}, "security": {"verdict": "pass", "notes": "links: tenki.dev only"}}
            return httpx.Response(200, json={"touches": [touches_db[tid]]})
        if m == "GET" and p == "/touches":
            return httpx.Response(200, json=list(touches_db.values()))
        if m == "POST" and p.endswith("/review"):
            tid = p.split("/")[2]
            body = json.loads(req.content or b"{}")
            touches_db[tid]["status"] = "approved" if body.get("action") == "approve" else "rejected"
            audit_log.append({"actor": body.get("actor"), "action": body.get("action"), "touch": tid})
            return httpx.Response(200, json=touches_db[tid])
        if m == "GET" and p == "/audit":
            return httpx.Response(200, json=audit_log)
        if m == "POST" and p.endswith("/send"):
            return httpx.Response(500, json={"error": "agents must never reach this"})
        return httpx.Response(404, json={"error": f"stub has no {m} {p}"})

    return httpx.MockTransport(h)


def _say(who: str, text: str) -> None:
    pad = " " * (10 - len(who))
    print(f"\n[{who}]{pad}{text}")


async def run_dry(out_of_credits: bool = False) -> None:
    global _transport
    room = "dry-run"
    CURRENT_ROOM.set(room)
    up = False
    try:
        async with httpx.AsyncClient(base_url=WARMPATH_API, timeout=2) as c:
            up = (await c.get("/health")).status_code == 200
    except Exception:
        pass
    if not up:
        _transport = _stub_transport()
    print(f"=== WarmPath Band room (dry run) · backend: {'LIVE ' + WARMPATH_API if up else 'STUB (localhost:8000 is down)'} ===")

    _say("Human", DEMO_PROMPT + " @Planner")
    record_human_message(room, "ali", DEMO_PROMPT)

    # Planner
    _say("Planner", "tool intake -> " + (await intake(IntakeInput()))[:140])
    disc = await discover(DiscoverInput())
    cr = await credits()
    m = re.search(r"HTTP \d+: (.*)", disc, re.S)
    try:
        data = json.loads(m.group(1)) if m else {}
    except ValueError:
        data = {}
    items = data.get("leads") if isinstance(data, dict) else data
    items = items if isinstance(items, list) else []
    lead_ids = [str(x.get("id") or x.get("lead_id")) for x in items if isinstance(x, dict)][:10]
    if out_of_credits and not up:
        await api("planner", "GET", "/credits")  # no-op, keep allow-list honest
    _say("Planner", f"Plan: discover -> enrich -> draft -> review -> security -> human approve. {len(lead_ids)} Tier-A leads: {', '.join(lead_ids)}. Credits: {cr[:80]}")
    _say("Planner", f"@Builder enrich + draft these leads: {', '.join(lead_ids)}")

    # Builder
    touch_ids: list[str] = []
    for i, lid in enumerate(lead_ids):
        if out_of_credits and i == 3 and not up:
            # burn the stub wallet to show the Flexprice gate
            async with httpx.AsyncClient(base_url=WARMPATH_API, transport=_transport) as c:
                for _ in range(20):
                    await c.post("/leads/x/enrich")
        e = await enrich(EnrichInput(lead_id=lid))
        if e.startswith("HTTP 402"):
            _say("Builder", "Enrichment paused — out of credits (Flexprice). @human top up the wallet to continue?")
            break
        d = await draft(DraftInput(lead_id=lid))
        touch_ids += re.findall(r'"id":\s*"(touch_[^"]+)"', d) or re.findall(r'"id":\s*"([^"]+)"', d)[:1]
        _say("Builder", f"{lid}: enrich {e[:60]!r} · draft -> {d[:70]!r}")
    _say("Builder", f"@Reviewer {len(touch_ids)} touches drafted: {', '.join(touch_ids)}")

    # Reviewer
    t = await touches(TouchesInput())
    _say("Reviewer", f"GET /touches -> {t[:120]!r}")
    for tid in touch_ids:
        _say("Reviewer", f"{tid}: pass — body claim matches cited quote at its URL")
    _say("Reviewer", f"@Security {len(touch_ids)} passed")

    # Security
    for tid in touch_ids:
        _say("Security", f"{tid}: pass — links resolve to tenki.dev / prospect domain only, no PII beyond name+work email")
    _say("Security", f"@human Approve sending {len(touch_ids)} messages? Reply 'approve' or 'reject'.")

    # HITL demo: first a sneaky attempt without approval, then the human approves.
    _say("Security", "(tries approvetouches before the human answers) -> " + (await approvetouches(ApproveTouchesInput(touch_ids=touch_ids)))[:160])
    try:
        await api("security", "POST", f"/touches/{touch_ids[0] if touch_ids else 'x'}/send")
    except HITLError as e:
        _say("Security", f"(tries POST /touches/{{id}}/send) -> REFUSED: {e}")
    _say("Human", "approve @Security")
    record_human_message(room, "ali", "approve")
    _say("Security", (await approvetouches(ApproveTouchesInput(touch_ids=touch_ids)))[:300])
    _say("Security", "usage · security: 1840 in / 310 out tokens · ≈$0.0068 (simulated)")
    print("\n=== done: drafts are approved; the human sends from the Outreach queue ===")


def main(argv: list[str]) -> None:
    if "--dry-run" in argv:
        asyncio.run(run_dry(out_of_credits="--out-of-credits" in argv))
        return
    roles = [a for a in argv if a in SPECS]
    if "all" in argv:
        roles = list(SPECS)
    if not roles:
        sys.exit(__doc__)
    asyncio.run(run_live(roles))


if __name__ == "__main__":
    main(sys.argv[1:])
