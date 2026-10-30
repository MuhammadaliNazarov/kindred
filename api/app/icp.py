"""Intake → ICP (confidence per field) + 3 expansion segments with rationale/evidence."""
from __future__ import annotations

import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

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


# ---------------- field-level evidence (Tavily keyless → cached in api/data/cache/) ----------------
CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "cache"
MAX_SEARCHES = 20  # hard budget per ICP (11 fields + 3 segments ≈ 14)
TOPIC = "sandboxes code execution AI agents infrastructure"
_KEYWORDS = ("sandbox", "agent", "code execution", "untrusted code", "microvm", "firecracker", "isolat", "infrastructure", "e2b", "ephemeral", "container", "evals", "rl ")


def _cache_path(query: str) -> Path:
    return CACHE_DIR / f"icp_{hashlib.sha1(query.lower().encode()).hexdigest()[:16]}.json"


def _best_quote(content: str) -> str:
    """Pick the snippet sentence that best supports 'this segment buys sandboxes/agent infra'."""
    text = re.sub(r"\s+", " ", content or "").strip()
    sents = [x for x in re.split(r"(?<=[.!?])\s+", text) if 40 <= len(x) <= 400] or ([text] if text else [])
    if not sents:
        return ""
    def score(x: str) -> float:  # keyword hits, minus markdown headings / elided snippets
        return sum(k in x.lower() for k in _KEYWORDS) - 2 * ("[...]" in x or "..." in x) - 2 * x.lstrip().startswith(("#", "|", "*", "-"))
    return max(sents, key=score).strip()[:220]


def _evidence(query: str, limit: int = 2) -> list[Source]:
    """1-2 sources for a query. Verified quotes first; if none verify, keep the top hit marked verified=False.
    Cached on disk (search + validation) so re-runs of the same ICP cost 0 searches."""
    from . import discovery, validator

    cp = _cache_path(query)
    try:
        return [Source(**x) for x in json.loads(cp.read_text())["sources"]]
    except Exception:
        pass
    hits = discovery.search(query, n=5)
    verified, unverified = [], []
    for h in hits:
        if len(verified) >= limit or not h.get("url"):
            break
        quote = _best_quote(h.get("content", ""))
        if not quote:
            continue
        src = Source(url=h["url"], title=h.get("title", "")[:160], quote=quote, fetched_at=thinking.now(), verified=False)
        validator.validate(src, agent="icp")
        (verified if src.verified else unverified).append(src)
    out = verified[:limit] or unverified[:1]
    if hits:  # don't cache an empty result (could be a rate-limit blip)
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cp.write_text(json.dumps({"query": query, "sources": [x.model_dump() for x in out]}, indent=1))
        except Exception:
            pass
    return out


def _adjust(conf: float, srcs: list[Source]) -> float:
    """Confidence follows the evidence: verified source keeps it, unverified-only trims it, none caps it."""
    if any(x.verified for x in srcs):
        return round(min(conf, 0.95), 2)
    if srcs:
        return round(min(conf * 0.85, 0.75), 2)
    return round(min(conf * 0.7, 0.55), 2)


def _field_queries(icp: ICP) -> list[tuple[object, str]]:
    q: list[tuple[object, str]] = []
    for f in icp.industries[:3]:
        q.append((f, f"{f.value.name} companies adopting {TOPIC}"))
    sz = icp.company_size.value
    q.append((icp.company_size, f"startups with {sz.min_headcount}-{sz.max_headcount} employees buying {TOPIC}"))
    for f in icp.personas[:3]:
        q.append((f, f"{f.value.title} evaluating {TOPIC}"))
    for f in icp.triggers[:4]:
        q.append((f, f"{f.value.description} {TOPIC}"[:380]))
    return q


def attach_sources(icp: ICP, exps_raw: list[dict]) -> list[list[Source]]:
    """Attach 1-2 real sources (with quote) to every industry, persona, trigger and the size band, and gather the
    3 expansion segments' evidence, in parallel within MAX_SEARCHES. Returns the segments' sources."""
    from . import discovery

    if not discovery.live():
        return [[] for _ in exps_raw]
    fields = _field_queries(icp)
    seg_qs = [e.get("search_query") or f"{e['name']} {TOPIC}" for e in exps_raw]
    budget = MAX_SEARCHES - len(seg_qs)
    fields = fields[:budget]
    thinking.emit("icp", "search", f"Sourcing {len(fields)} ICP fields + {len(seg_qs)} segments (≤{MAX_SEARCHES} searches, cached)")
    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(lambda q: _evidence(q), [q for _, q in fields] + seg_qs))
    found = 0
    for (f, _), srcs in zip(fields, results):
        old = [x for x in (f.sources or []) if "example.com" not in x.url]
        f.sources = (srcs or old) or None
        f.confidence = _adjust(f.confidence, f.sources or [])
        found += bool(f.sources)
    thinking.emit("icp", "reason", f"Sources attached to {found}/{len(fields)} ICP fields; confidence lowered where none found")
    return results[len(fields):]


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
    evidence = attach_sources(icp, exps_raw)  # live sources per ICP field + per segment (Tavily, cached)
    for i, (e, ev) in enumerate(zip(exps_raw, evidence), 1):
        sources: list[Source] = list(ev)
        conf = _adjust(float(e.get("confidence", 0.5)), sources)
        if not sources and not was_live:
            sources = [_src(f"https://example.com/evidence/segment-{i}", f"{e['name']} (demo evidence)", e["rationale"][:90])]
        exps.append(ExpansionSegment(id=f"seg{i}", name=e["name"], rationale=e["rationale"], confidence=conf, sources=sources, status="suggested"))
    thinking.emit("icp", "reason", f"ICP ready: {len(icp.industries)} industries, {len(icp.personas)} personas, {len(icp.triggers)} triggers; {len(exps)} expansion segments")
    with state.lock:
        state.intake, state.icp = intake, icp
        state.expansions = {x.id: x for x in exps}
    state.log("ai", "icp_built", f"ICP for {intake.product_name} ({'claude' if was_live else 'fallback'})", agent="icp")
    return icp, exps
