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


def fallback_icp(intake: Intake, profile: dict | None = None) -> dict:
    if not state.is_default_product(intake):
        return generic_icp(intake, profile)  # never the canned Tenki ICP for someone else's company
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


# ---------------- any other company: ICP from its own words (evidence pack + icp_hints) ----------------
_STOPW = set("the a an and or to of in on for at by with is are was were be this that it its your you we our from as about who their them they".split())


def _words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{4,}", (s or "").lower()) if w not in _STOPW}


def pack_of(profile: dict | None) -> list[Source]:
    out = []
    for x in (profile or {}).get("evidence", []) or []:
        try:
            out.append(Source(**x))
        except Exception:
            pass
    return out


def match_sources(text: str, pack: list[Source], seller_dom: str = "", limit: int = 2) -> list[Source]:
    """Best evidence-pack quotes for a field: word overlap, website (first-party) quotes first."""
    w = _words(text)
    if not w or not pack:
        return []
    def sc(s: Source) -> float:
        ov = len(w & _words(s.quote + " " + s.title))
        return ov + (1.5 if seller_dom and seller_dom in s.url else 0) + 0.5 * s.verified if ov else 0
    ranked = sorted((s for s in pack if sc(s) > 0), key=sc, reverse=True)
    return ranked[:limit]


def generic_icp(intake: Intake, profile: dict | None) -> dict:
    hints = (profile or {}).get("icp_hints") or []
    text = " ".join(hints + [intake.description, " ".join(intake.features)]).lower()
    pack = pack_of(profile)
    dom = intake.product_url.split("//")[-1].split("/")[0].replace("www.", "")
    srcs = lambda t: match_sources(t, pack, dom) or None
    lead_hint = hints[0] if hints else intake.description[:80]
    founders = any(k in text for k in ("founder", "startup", "entrepreneur"))
    xborder = any(k in text for k in ("border", "international", "global", "visa", "immigra", "abroad", "relocat", "expat", "cross-border"))
    legal = any(k in text for k in ("law", "legal", "incorporat", "compliance", "attorney", "lawyer"))
    dev = any(k in text for k in ("developer", "engineer", "api", "sdk", "code"))
    inds = []
    if founders:
        inds.append(("Venture-backed startups (seed–Series B)", "541511", 0.82))
    if xborder:
        inds.append(("Startups expanding or incorporating across borders", "561110", 0.78))
    if dev:
        inds.append(("Software & developer-tool companies", "513210", 0.7))
    inds = inds or [(f"Companies served by {intake.product_name}: {lead_hint}"[:90], "", 0.6)]
    personas = ([("Founder / CEO", "C-level", "Executive"), ("COO / Head of Operations", "C-level", "Operations"), ("Head of People / Talent", "Director", "HR")]
                if founders else [("CTO / Head of Engineering", "C-level", "Engineering"), ("Engineering Manager", "Director", "Engineering")] if dev
                else [("Founder / CEO", "C-level", "Executive"), ("Head of Operations", "Director", "Operations")])
    trig = [("funding", "Raised a seed–Series B round in the last 90 days")]
    if xborder:
        trig = [("launch", "Incorporating a US entity (Delaware C-Corp) or flipping from a foreign parent"),
                ("job_post", "Making a first international hire or hiring across borders"),
                ("exec_hire", "Founder or key hire needs a US visa / immigration (O-1, E-2, H-1B)"),
                ("funding", "Raised a seed–Series B round, often with US investors requiring a US entity")]
    elif legal:
        trig += [("launch", "Forming a new entity, launching a product or entering a new market"), ("job_post", "Hiring first employees or contractors")]
    else:
        trig += [("job_post", f"Hiring for the problem {intake.product_name} solves"), ("launch", "Launched a new product or entered a new market")]
    core = lambda name, conf, extra: {"value": name, "confidence": conf, "sources": srcs(extra)}
    return {
        "icp": {
            "industries": [core({"name": n, "naics": c}, cf, n + " " + lead_hint) for n, c, cf in inds[:3]],
            "company_size": core({"min_headcount": 1, "max_headcount": 200 if founders else 500, "revenue_band": "Pre-revenue–$20M ARR" if founders else "$1M–$100M"},
                                 0.6, lead_hint + " startups team"),
            "personas": [core({"title": t, "seniority": sn, "function": fn}, 0.8 - i * 0.08, t + " " + lead_hint) for i, (t, sn, fn) in enumerate(personas)],
            "triggers": [core({"type": ty, "description": d}, 0.78 - i * 0.05, d) for i, (ty, d) in enumerate(trig)],
            "negative_signals": ["Public companies with in-house teams for this", "No evidence of the stated need"],
            "regions": ["North America", "Europe", "Global (cross-border)"] if xborder else ["North America", "Europe"],
        },
        "expansions": [
            {"name": f"Accelerator & VC portfolio companies ({lead_hint[:40]})", "rationale": "Accelerators and funds push their founders to the same need at the same moment (incorporation, first raise).", "confidence": 0.6, "search_query": f"accelerator portfolio founders {lead_hint}"[:200]},
            {"name": "Remote-first teams hiring internationally" if xborder else f"Adjacent buyers of {intake.product_name}", "rationale": "Same trigger, different company shape.", "confidence": 0.52, "search_query": f"{lead_hint} hiring internationally startup"[:200]},
            {"name": "Founders relocating to the US" if xborder else "Agencies serving the core ICP", "rationale": "Individuals with the same need before a company exists.", "confidence": 0.48, "search_query": f"founders relocating {lead_hint}"[:200]},
        ],
    }


# ---------------- field-level evidence (Tavily keyless → cached in api/data/cache/) ----------------
CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "cache"
MAX_SEARCHES = 20  # hard budget per ICP (11 fields + 3 segments ≈ 14)
TOPIC = "sandboxes code execution AI agents infrastructure"
_KEYWORDS = ("sandbox", "agent", "code execution", "untrusted code", "microvm", "firecracker", "isolat", "infrastructure", "e2b", "ephemeral", "container", "evals", "rl ")


def _cache_path(query: str) -> Path:
    return CACHE_DIR / f"icp_{hashlib.sha1(query.lower().encode()).hexdigest()[:16]}.json"


def _topic(intake: Intake | None, profile: dict | None = None) -> str:
    if state.is_default_product(intake):
        return TOPIC
    hints = (profile or {}).get("icp_hints") or []
    return (hints[0] if hints else intake.description)[:90]


def _kw(intake: Intake | None = None, profile: dict | None = None) -> tuple[str, ...]:
    if state.is_default_product(intake):
        return _KEYWORDS
    return tuple(sorted(_words(" ".join(((profile or {}).get("icp_hints") or []) + [intake.description])))) or _KEYWORDS


def _best_quote(content: str, kws: tuple[str, ...] = _KEYWORDS) -> str:
    """Pick the snippet sentence that best supports 'this segment buys sandboxes/agent infra'."""
    text = re.sub(r"\s+", " ", content or "").strip()
    sents = [x for x in re.split(r"(?<=[.!?])\s+", text) if 40 <= len(x) <= 400] or ([text] if text else [])
    if not sents:
        return ""
    def score(x: str) -> float:  # keyword hits, minus markdown headings / elided snippets
        return sum(k in x.lower() for k in kws) - 2 * ("[...]" in x or "..." in x) - 2 * x.lstrip().startswith(("#", "|", "*", "-"))
    return max(sents, key=score).strip()[:220]


def _evidence(query: str, limit: int = 2, kws: tuple[str, ...] = _KEYWORDS) -> list[Source]:
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
        quote = _best_quote(h.get("content", ""), kws)
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


def _field_queries(icp: ICP, TOPIC: str = TOPIC) -> list[tuple[object, str]]:
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


def attach_sources(icp: ICP, exps_raw: list[dict], intake: Intake | None = None, profile: dict | None = None) -> list[list[Source]]:
    """Attach 1-2 real sources (with quote) to every industry, persona, trigger and the size band, and gather the
    3 expansion segments' evidence, in parallel within MAX_SEARCHES. Returns the segments' sources."""
    from . import discovery

    if not discovery.live():
        return [[] for _ in exps_raw]
    topic, kws = _topic(intake, profile), _kw(intake, profile)
    fields = _field_queries(icp, topic)
    if not state.is_default_product(intake):  # fields already backed by the company's own evidence don't need a search
        fields = [(f, q) for f, q in fields if not getattr(f, "sources", None)]
    seg_qs = [e.get("search_query") or f"{e['name']} {topic}" for e in exps_raw]
    budget = MAX_SEARCHES - len(seg_qs)
    fields = fields[:budget]
    thinking.emit("icp", "search", f"Sourcing {len(fields)} ICP fields + {len(seg_qs)} segments (≤{MAX_SEARCHES} searches, cached)")
    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(lambda q: _evidence(q, kws=kws), [q for _, q in fields] + seg_qs))
    found = 0
    for (f, _), srcs in zip(fields, results):
        old = [x for x in (f.sources or []) if "example.com" not in x.url]
        f.sources = (old + srcs)[:3] if old else (srcs or None)
        f.confidence = _adjust(f.confidence, f.sources or [])
        found += bool(f.sources)
    thinking.emit("icp", "reason", f"Sources attached to {found}/{len(fields)} ICP fields; confidence lowered where none found")
    return results[len(fields):]


ICP_EVIDENCE_RULES = """
The input also has `evidence` (numbered quotes from the seller's OWN website and web search) and `icp_hints` (who the seller says it serves).
Rules: the seller's own stated audience WINS over your priors: build industries/personas/triggers around icp_hints
(e.g. "founders building across borders" -> personas Founder/CEO, COO of seed-Series B startups; triggers such as incorporating in the US,
first international hire, visa/immigration needs, a funding round). Never describe a different product category than the evidence.
For EVERY industry, persona, trigger and company_size add "evidence_ids":[int] citing the quotes that support it (website quotes first).
Lower confidence when no quote supports a field."""


def _cite(node: dict, pack: list[Source]) -> None:
    ids = node.pop("evidence_ids", None) or []
    srcs = [pack[i] for i in ids if isinstance(i, int) and 0 <= i < len(pack)]
    if srcs:
        node["sources"] = [x.model_dump() for x in srcs[:3]]


def run(intake: Intake) -> tuple[ICP, list[ExpansionSegment]]:
    thinking.emit("icp", "handoff", f"Planner → ICP agent: build ICP for {intake.product_name}")
    default = state.is_default_product(intake)
    profile = None
    if not default:
        from . import analyze
        profile = analyze.profile_for(intake)
        if not profile:
            try:
                profile = analyze.run(intake.product_url, intake.product_name, intake.description)
            except Exception as e:
                thinking.emit("icp", "reason", f"Company analysis failed ({type(e).__name__}); ICP from the intake only")
    pack = pack_of(profile)
    dom = intake.product_url.split("//")[-1].split("/")[0].replace("www.", "")
    if default:
        system, prompt = ICP_SYSTEM, "Intake:\n" + json.dumps(intake.model_dump(), indent=2)
    else:
        system = ICP_SYSTEM + ICP_EVIDENCE_RULES
        prompt = json.dumps({"intake": intake.model_dump(), "icp_hints": (profile or {}).get("icp_hints", []), "summary": (profile or {}).get("summary", ""),
                             "evidence": [{"id": i, "url": s.url, "quote": s.quote, "first_party": dom in s.url} for i, s in enumerate(pack)]}, indent=1)
    data, was_live = llm.json_call("icp", system, prompt, lambda: fallback_icp(intake, profile), max_tokens=5000)
    try:
        if pack and was_live:
            ic = data["icp"]
            for k in ("industries", "personas", "triggers"):
                for node in ic.get(k, []):
                    _cite(node, pack)
            _cite(ic["company_size"], pack)
        icp = ICP.model_validate(data["icp"])
        exps_raw = data["expansions"][:3]
    except Exception as e:
        thinking.emit("icp", "reason", f"ICP JSON invalid ({type(e).__name__}); using fallback")
        data = fallback_icp(intake, profile)
        icp, exps_raw = ICP.model_validate(data["icp"]), data["expansions"]
    if not default and pack:  # any field the LLM left uncited: best-matching website quote
        for f in [*icp.industries, *icp.personas, *icp.triggers]:
            if not f.sources:
                v = f.value
                f.sources = match_sources(" ".join(str(x) for x in v.model_dump().values()) + " " + " ".join((profile or {}).get("icp_hints", [])[:1]), pack, dom) or None
    exps: list[ExpansionSegment] = []
    evidence = attach_sources(icp, exps_raw, intake, profile)  # live sources per ICP field + per segment (Tavily, cached)
    for i, (e, ev) in enumerate(zip(exps_raw, evidence), 1):
        sources: list[Source] = list(ev)
        conf = _adjust(float(e.get("confidence", 0.5)), sources)
        if not sources and not was_live and default:
            sources = [_src(f"https://example.com/evidence/segment-{i}", f"{e['name']} (demo evidence)", e["rationale"][:90])]
        exps.append(ExpansionSegment(id=f"seg{i}", name=e["name"], rationale=e["rationale"], confidence=conf, sources=sources, status="suggested"))
    thinking.emit("icp", "reason", f"ICP ready: {len(icp.industries)} industries, {len(icp.personas)} personas, {len(icp.triggers)} triggers; {len(exps)} expansion segments")
    with state.lock:
        state.intake, state.icp = intake, icp
        state.expansions = {x.id: x for x in exps}
        if profile:
            state.profile = profile
    state.log("ai", "icp_built", f"ICP for {intake.product_name} ({'claude' if was_live else 'fallback'})", agent="icp")
    return icp, exps
