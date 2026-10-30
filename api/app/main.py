"""Warmpath API. Run: uv run uvicorn app.main:app --reload --port 8000"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, Header, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from sse_starlette.sse import EventSourceResponse  # noqa: E402

from . import bandit, billing, discovery, enrich, graph, icp, llm, outreach, pipeline, seed, state, thinking, verifier  # noqa: E402
from pydantic import BaseModel  # noqa: E402
from .models import (AuditEvent, Company, Credits, ExpansionSegment, ExpansionUpdate, GraphData, ICP, Intake, Lead,  # noqa: E402
                     MoveBody, Person, ReviewBody, ThinkingStep, Touch, WarmPath)


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed.load()
    yield


app = FastAPI(title="Warmpath API", version="0.1.0", lifespan=lifespan)
origins = [o.strip() for o in os.getenv("CORS_ORIGIN", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_origin_regex=os.getenv("CORS_ORIGIN_REGEX") or None,
                   allow_credentials=False, allow_methods=["*"], allow_headers=["*"])


def demo_key(x_demo_key: Optional[str] = Header(default=None)):
    """Light guard on mutating/costly routes: enforced only when DEMO_KEY is set (stops casual scanning; not real auth)."""
    want = os.getenv("DEMO_KEY")
    if want and x_demo_key != want:
        raise HTTPException(401, "missing or bad X-Demo-Key")


guard = [Depends(demo_key)]


@app.get("/health")
def health():
    return {
        "ok": True,
        "modes": {
            "llm": llm.mode(),
            "search": "tavily" if os.getenv("TAVILY_API_KEY") else "tavily-keyless" if discovery.tavily_keyless() else "serper" if os.getenv("SERPER_API_KEY") else "seed",
            "enrichment": "hunter" if os.getenv("HUNTER_API_KEY") else "apollo" if os.getenv("APOLLO_API_KEY") else "seed",
            "email": "sendgrid" if all(os.getenv(k) for k in ("SENDGRID_API_KEY", "SENDGRID_FROM", "DEMO_INBOX")) else "simulated",
            "billing": "flexprice" if billing.live() else "local_ledger",
            "graph": "kuzu",
        },
        "notes": {"llm": llm.detail()},  # e.g. "anthropic: 401 AuthenticationError" when the key was rejected and we fell through
        "counts": {"companies": len(state.companies), "people": len(state.people), "leads": len(state.leads), "touches": len(state.touches)},
    }


# ---------- intake / ICP ----------
@app.post("/intake")
def post_intake(body: Intake):
    if body.past_employers:
        seed.set_me_history(body.past_employers)
    graph.upsert_product(body.product_name, body.product_url)
    i, exps = icp.run(body)
    discovery.rescore_all()
    # Re-draft the first lead's queued touches so the warm-path employer in the email matches the new graph.
    first = state.leads.get("L1") or next(iter(state.leads.values()), None)
    if first:
        try:
            outreach.draft(first.id, use_llm=False)
        except HTTPException:
            pass
    return {"icp": i, "expansions": exps}


@app.get("/icp", response_model=Optional[ICP])
def get_icp():
    return state.icp


@app.get("/expansions", response_model=list[ExpansionSegment])
def get_expansions():
    return list(state.expansions.values())


@app.post("/expansions/{seg_id}", response_model=ExpansionSegment)
def update_expansion(seg_id: str, body: ExpansionUpdate):
    seg = state.expansions.get(seg_id)
    if not seg:
        raise HTTPException(404, "segment not found")
    seg.status = body.status
    if body.name:
        seg.name = body.name
    if body.rationale:
        seg.rationale = body.rationale
    state.log("rep", f"segment_{body.status}", seg.name)
    thinking.emit("planner", "reason", f"Expansion '{seg.name}' {body.status} by rep")
    return seg


# ---------- discovery / graph ----------
@app.post("/discover", dependencies=guard)
def post_discover():
    return discovery.run()


@app.get("/companies", response_model=list[Company])
def get_companies():
    return sorted(state.companies.values(), key=lambda c: -c.score)


@app.get("/dropped")
def get_dropped():
    """Claims the validator dropped (quote not found at URL), verified:false — for a 'show dropped' view."""
    return state.dropped_claims


@app.get("/people", response_model=list[Person])
def get_people():
    return list(state.people.values())


@app.get("/graph", response_model=GraphData)
def get_graph(lead: Optional[str] = None):
    if lead:
        l = pipeline.get_lead(lead)
        return graph.subgraph(l.person_id, l.company_id)
    return graph.subgraph(None, None)


@app.get("/warm-path/{lead_id}", response_model=WarmPath)
def get_warm_path(lead_id: str):
    l = pipeline.get_lead(lead_id)
    hops, cy = graph.warm_path(graph.ME, l.person_id)
    return WarmPath(lead_id=lead_id, hops=hops, cypher=cy)


# ---------- leads ----------
@app.get("/leads", response_model=list[Lead])
def get_leads():
    return list(state.leads.values())


@app.post("/leads/{lead_id}/move", response_model=Lead)
def move_lead(lead_id: str, body: MoveBody):
    return pipeline.move(lead_id, body.stage, body.actor, agent=None if body.actor == "rep" else "planner")


@app.post("/leads/{lead_id}/enrich", response_model=Person, dependencies=guard)
def enrich_lead(lead_id: str):
    # Accept a person id too (the UI may only know the person): map it to that person's lead.
    if lead_id not in state.leads:
        lead_id = next((l.id for l in state.leads.values() if l.person_id == lead_id), lead_id)
    return enrich.enrich_lead(lead_id)


@app.post("/leads/{lead_id}/draft", response_model=list[Touch])
def draft_lead(lead_id: str):
    return outreach.draft(lead_id)


# ---------- outreach ----------
@app.get("/touches", response_model=list[Touch])
def get_touches(lead_id: Optional[str] = None):
    return [t for t in state.touches.values() if not lead_id or t.lead_id == lead_id]


@app.post("/touches/{touch_id}/review", response_model=Touch, dependencies=guard)
def review_touch(touch_id: str, body: ReviewBody):
    # Review is the human-in-the-loop click: always logged as the rep, whatever the caller claims.
    t = outreach.review_touch(touch_id, body.action, "rep", body.body, body.subject)
    if body.action == "approve" and t.channel == "email":
        try:
            t = outreach.send_touch(touch_id)  # approved by a human → send (SendGrid to DEMO_INBOX only, else simulated)
        except HTTPException as e:
            if e.status_code not in (402, 422):
                raise
            thinking.emit("builder", "reason", f"Approved {touch_id} but not sent: {e.detail}")  # stays 'approved'
    return t


@app.post("/touches/{touch_id}/send", response_model=Touch, dependencies=guard)
def send_touch(touch_id: str):
    return outreach.send_touch(touch_id)


# ---------- audit / credits / analytics / thinking ----------
@app.post("/reset", dependencies=guard)
def reset_all():
    """Reseed everything (companies, people, leads, touches, audit, credits, bandit) — run before recording."""
    with state.lock:
        state.intake = state.icp = None
        for d in (state.expansions, state.companies, state.people, state.leads, state.touches, outreach.state_warm):
            d.clear()
        state.audit.clear()
        state.dropped_claims.clear()
        pipeline._variant_flip[0] = 0
        seed.CONNECTORS.clear()
    billing.reset()
    bandit.reset_all()
    seed.load()
    return health()


@app.get("/audit", response_model=list[AuditEvent])
def get_audit():
    return list(reversed(state.audit))


@app.get("/credits", response_model=Credits)
def get_credits():
    return billing.credits()


@app.post("/credits/reset", response_model=Credits, dependencies=guard)
def reset_credits():
    return billing.reset()


@app.get("/analytics")
def get_analytics():
    return pipeline.analytics()


@app.get("/thinking", response_model=list[ThinkingStep])
def get_thinking(limit: int = 200):
    return thinking.history(limit)


@app.get("/thinking/stream")
async def thinking_stream(request: Request):
    return EventSourceResponse(thinking.stream(request), ping=15)


# ---------- learning loop: bandit + verifier ----------
class ReplyHook(BaseModel):
    lead_id: str


class SimBody(BaseModel):
    sends: int = 300
    seed: Optional[int] = None


class VerifyBody(BaseModel):
    text: str
    company: str = ""
    signal: str = ""


@app.get("/bandit")
def get_bandit():
    return bandit.summary()


@app.post("/bandit/simulate", dependencies=guard)
def simulate_bandit(body: SimBody = SimBody()):
    return bandit.simulate(max(1, min(body.sends, 5000)), body.seed)


@app.post("/bandit/reset", dependencies=guard)
def reset_bandit_sim():
    """Clear the SIMULATED overlay; GET /bandit then shows real reply-learned stats."""
    return bandit.reset_sim()


@app.post("/webhooks/reply")
def reply_webhook(body: ReplyHook):
    lead = pipeline.get_lead(body.lead_id)
    arm = pipeline.lead_arm(lead)
    if lead.stage in ("matched", "contacted"):
        pipeline.move(lead.id, "replied", "ai", agent="planner", why="reply webhook")
    elif arm:
        bandit.update(arm, 1, lead_id=lead.id)
    return {"ok": True, "lead_id": lead.id, "arm": arm, "bandit": bandit.summary()}


@app.post("/verify")
def post_verify(body: VerifyBody):
    allowed = [state.intake.product_url.split("//")[-1].split("/")[0]] if state.intake else ["tenki.cloud"]
    return verifier.verify(body.text, body.company, body.signal, allowed_domains=allowed)
