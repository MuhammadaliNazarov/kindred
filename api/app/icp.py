"""Intake → ICP (confidence per field) + 3 expansion segments with rationale/evidence."""
from __future__ import annotations

import json

from . import llm, state, thinking
from .models import ICP, ExpansionSegment, Intake, Source

ICP_SYSTEM = """You are the ICP agent of an evidence-first GTM engine. From a product intake, infer the Ideal Customer Profile.
Give every field a confidence 0..1 that reflects how directly the intake supports it (lower when you are guessing).
Return JSON: {"icp": {"industries":[{"value":{"name":str,"naics":str},"confidence":float}],
"company_size":{"value":{"min_headcount":int,"max_headcount":int,"revenue_band":str},"confidence":float},
"personas":[{"value":{"title":str,"seniority":str,"function":str},"confidence":float}],
"triggers":[{"value":{"type":"funding|exec_hire|job_post|tech_change|launch","description":str},"confidence":float}],
"negative_signals":[str],"regions":[str]},
"expansions":[{"name":str,"rationale":str,"confidence":float,"search_query":str}] (exactly 3, adjacent segments not in the core ICP)}"""


def _src(url: str, title: str, quote: str) -> Source:
    return Source(url=url, title=title, quote=quote, fetched_at=thinking.now(), verified=False)


def fallback_icp(intake: Intake) -> dict:
    p = intake.product_name or "Tenki"
    ev = [_src("https://example.com/research/agent-infra-hiring", "Agent startups hiring infra (demo)", "agent startups are hiring infrastructure engineers to run untrusted code")]
    return {
        "icp": {
            "industries": [
                {"value": {"name": "AI agent platforms (software publishers)", "naics": "513210"}, "confidence": 0.86, "sources": ev},
                {"value": {"name": "Developer tools & coding assistants", "naics": "541511"}, "confidence": 0.78},
                {"value": {"name": "AI research & eval labs", "naics": "541715"}, "confidence": 0.61},
            ],
            "company_size": {"value": {"min_headcount": 10, "max_headcount": 250, "revenue_band": "$1M–$50M ARR"}, "confidence": 0.72},
            "personas": [
                {"value": {"title": "Head of Infrastructure", "seniority": "Director", "function": "Engineering"}, "confidence": 0.84},
                {"value": {"title": "CTO / Technical co-founder", "seniority": "C-level", "function": "Engineering"}, "confidence": 0.8},
                {"value": {"title": "Staff Platform Engineer", "seniority": "IC", "function": "Platform"}, "confidence": 0.63},
            ],
            "triggers": [
                {"value": {"type": "job_post", "description": f"Hiring infra/platform engineers to run agent code in sandboxes (where {p} replaces the build)"}, "confidence": 0.88, "sources": ev},
                {"value": {"type": "funding", "description": "Raised seed–Series B in the last 90 days"}, "confidence": 0.74},
                {"value": {"type": "launch", "description": "Launched an agent that executes code or browses on the user's behalf"}, "confidence": 0.7},
                {"value": {"type": "tech_change", "description": "Migrating off self-hosted Firecracker/Docker or a competing sandbox"}, "confidence": 0.55},
            ],
            "negative_signals": ["Hardware-first companies", "Over 1,000 employees with in-house sandbox team", "No product that executes code"],
            "regions": ["North America", "Europe"],
        },
        "expansions": [
            {"name": "RL environment & eval providers", "rationale": "They spin up thousands of short-lived sandboxes for rollouts and evals — the same primitive, at higher volume.", "confidence": 0.71, "search_query": "RL environments startup hiring infrastructure engineer sandboxes"},
            {"name": "Data notebook platforms running untrusted code", "rationale": "Hosted notebooks need isolation per user session; AI features increase untrusted code execution.", "confidence": 0.58, "search_query": "notebook platform AI code execution isolation hiring"},
            {"name": "CI for AI-generated pull requests", "rationale": "Teams validating agent-written code need ephemeral, fast environments per PR.", "confidence": 0.52, "search_query": "AI generated pull requests CI ephemeral environments startup"},
        ],
    }


def run(intake: Intake) -> tuple[ICP, list[ExpansionSegment]]:
    thinking.emit("icp", "handoff", f"Planner → ICP agent: build ICP for {intake.product_name}")
    data, was_live = llm.json_call("icp", ICP_SYSTEM, "Intake:\n" + json.dumps(intake.model_dump(), indent=2), lambda: fallback_icp(intake))
    try:
        icp = ICP.model_validate(data["icp"])
        exps_raw = data["expansions"][:3]
    except Exception as e:
        thinking.emit("icp", "reason", f"ICP JSON invalid ({type(e).__name__}); using fallback")
        data = fallback_icp(intake)
        icp, exps_raw = ICP.model_validate(data["icp"]), data["expansions"]
    exps: list[ExpansionSegment] = []
    for i, e in enumerate(exps_raw, 1):
        sources: list[Source] = []
        if e.get("search_query"):
            from . import discovery  # live evidence for the segment when a search key is set

            sources = discovery.evidence_for(e["search_query"], limit=2)
        if not sources and not was_live:
            sources = [_src(f"https://example.com/evidence/segment-{i}", f"{e['name']} (demo evidence)", e["rationale"][:90])]
        exps.append(ExpansionSegment(id=f"seg{i}", name=e["name"], rationale=e["rationale"], confidence=float(e.get("confidence", 0.5)), sources=sources, status="suggested"))
    thinking.emit("icp", "reason", f"ICP ready: {len(icp.industries)} industries, {len(icp.personas)} personas, {len(icp.triggers)} triggers; {len(exps)} expansion segments")
    with state.lock:
        state.intake, state.icp = intake, icp
        state.expansions = {x.id: x for x in exps}
    state.log("ai", "icp_built", f"ICP for {intake.product_name} ({'claude' if was_live else 'fallback'})", agent="icp")
    return icp, exps
