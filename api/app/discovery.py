"""Discovery: Tavily (→ Serper → seed) search for companies + job posts matching the ICP, quote validation, scoring."""
from __future__ import annotations

import json
import os
import re
from datetime import date, datetime
from urllib.parse import urlparse

import httpx

from . import graph, llm, state, thinking, validator
from .models import ICP, Company, Person, Signal, Source

JOB_BOARDS = {"jobs.ashbyhq.com", "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "apply.workable.com", "wellfound.com", "www.ycombinator.com"}
TODAY = date.today


# ---------------- search ----------------
def search(query: str, n: int = 6) -> list[dict]:
    """Returns [{title,url,content}] from Tavily, else Serper, else []."""
    if os.getenv("TAVILY_API_KEY"):
        try:
            thinking.emit("discovery", "search", f"Tavily: {query}")
            r = httpx.post(
                "https://api.tavily.com/search",
                headers={"Authorization": f"Bearer {os.environ['TAVILY_API_KEY']}"},
                json={"query": query, "max_results": n, "search_depth": "basic", "topic": "general"},
                timeout=20,
            )
            r.raise_for_status()
            return [{"title": x.get("title", ""), "url": x["url"], "content": x.get("content", "")} for x in r.json().get("results", [])]
        except Exception as e:
            thinking.emit("discovery", "search", f"Tavily failed ({type(e).__name__}); trying Serper")
    if os.getenv("SERPER_API_KEY"):
        try:
            thinking.emit("discovery", "search", f"Serper: {query}")
            r = httpx.post("https://google.serper.dev/search", headers={"X-API-KEY": os.environ["SERPER_API_KEY"]}, json={"q": query, "num": n}, timeout=20)
            r.raise_for_status()
            return [{"title": x.get("title", ""), "url": x["link"], "content": x.get("snippet", "")} for x in r.json().get("organic", [])]
        except Exception as e:
            thinking.emit("discovery", "search", f"Serper failed ({type(e).__name__})")
    return []


def live() -> bool:
    return bool(os.getenv("TAVILY_API_KEY") or os.getenv("SERPER_API_KEY"))


def _first_sentence(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r"(?<=[.!?])\s+", text)
    s = next((p for p in parts if len(p) > 40), text)
    return s[:200]


def evidence_for(query: str, limit: int = 2) -> list[Source]:
    out = []
    for r in search(query, n=4):
        if len(out) >= limit:
            break
        src = Source(url=r["url"], title=r["title"], quote=_first_sentence(r["content"]), fetched_at=thinking.now(), verified=False)
        validator.validate(src, agent="icp")
        if src.verified:
            out.append(src)
        else:
            state.dropped_claims.append({"claim": r["title"], **src.model_dump()})
    return out


# ---------------- scoring ----------------
SIGNAL_STRENGTH = {"job_post": 1.0, "funding": 0.9, "exec_hire": 0.8, "churn_risk": 0.8, "tech_change": 0.7, "launch": 0.65}


def _days_ago(d: str) -> int:
    try:
        return max(0, (TODAY() - datetime.fromisoformat(d[:10]).date()).days)
    except Exception:
        return 45


def score(c: Company, icp: ICP | None, people: list[Person]) -> Company:
    fit = 0
    if icp:
        naics = {i.value.naics for i in icp.industries}
        names = " ".join(i.value.name.lower() for i in icp.industries)
        if c.naics in naics:
            fit += 22
        elif any(w in names for w in c.industry.lower().split() if len(w) > 3):
            fit += 12
        sz = icp.company_size.value
        if sz.min_headcount <= c.headcount <= sz.max_headcount:
            fit += 16
        elif c.headcount <= sz.max_headcount * 3:
            fit += 6
        ptitles = " ".join(p.value.title.lower() for p in icp.personas)
        if any(any(w in ptitles for w in p.title.lower().split() if len(w) > 3) for p in people):
            fit += 10
    fit += min(12, 4 * sum(1 for s in c.sources + [g.source for g in c.signals] if s.url))
    fit = min(60, fit)
    intent = 0.0
    for s in c.signals:
        rec = max(0.0, 1 - _days_ago(s.date) / 60)
        intent = max(intent, 34 * SIGNAL_STRENGTH.get(s.type, 0.5) * rec)
    intent += min(6, 2 * max(0, len(c.signals) - 1))
    c.fit, c.intent = int(fit), int(min(40, round(intent)))
    c.score = c.fit + c.intent
    c.tier = "A" if c.score >= 75 else "B" if c.score >= 50 else "C"
    return c


def rescore_all() -> None:
    for c in state.companies.values():
        score(c, state.icp, [p for p in state.people.values() if p.company_id == c.id])
        graph.upsert_company(c)


# ---------------- live discovery ----------------
EXTRACT_SYSTEM = """Extract buying signals from search results for an ICP. For each result that clearly names ONE company with a signal,
return {"items":[{"idx":int,"company":str,"domain":str|null,"industry":str,"naics":str,"headcount":int|null,"hq":str|null,
"signal_type":"job_post|funding|exec_hire|tech_change|launch","summary":str,"quote":str,"date":"YYYY-MM-DD"|null,"persona_title":str|null}]}.
`quote` MUST be copied verbatim from that result's content (8-30 words). Skip results that are lists, news roundups or job aggregators."""


def _company_from_url(url: str, title: str) -> tuple[str, str]:
    u = urlparse(url)
    host = u.netloc.lower()
    if host in JOB_BOARDS:
        slug = [p for p in u.path.split("/") if p][:1]
        slug = slug[0] if slug else host
        if host == "www.ycombinator.com":
            m = re.search(r"/companies/([^/]+)", u.path)
            slug = m.group(1) if m else slug
        return slug.replace("-", " ").title(), f"{slug}.com"
    name = re.split(r" [-|–—] | at ", title)[-1].strip()[:40] if " at " in title or " - " in title else host.replace("www.", "").split(".")[0].title()
    return name, host.replace("www.", "")


def _queries(icp: ICP) -> list[str]:
    persona = icp.personas[0].value.title if icp.personas else "infrastructure engineer"
    trig = next((t.value.description for t in icp.triggers if t.value.type == "job_post"), "")
    ind = icp.industries[0].value.name if icp.industries else "AI startup"
    qs = [
        f"{ind} hiring {persona} sandbox code execution site:jobs.ashbyhq.com OR site:jobs.lever.co OR site:boards.greenhouse.io",
        f"AI agent startup job post infrastructure engineer sandboxes {trig[:60]}",
        f"{ind} raises seed Series A 2026 agents",
    ]
    for seg in state.expansions.values():
        if seg.status in ("accepted", "adjusted"):
            qs.append(f"{seg.name} startup hiring infrastructure engineer")
    return qs


def discover_live(icp: ICP) -> int:
    results = []
    for q in _queries(icp):
        results += search(q, n=6)
    seen, uniq = set(), []
    for r in results:
        if r["url"] not in seen:
            seen.add(r["url"])
            uniq.append(r)
    thinking.emit("discovery", "reason", f"{len(uniq)} candidate results; extracting claims {{claim, url, quote}}")

    def fb():
        items = []
        for i, r in enumerate(uniq):
            name, dom = _company_from_url(r["url"], r["title"])
            is_job = urlparse(r["url"]).netloc.lower() in JOB_BOARDS or "hiring" in r["title"].lower() or "job" in r["url"]
            items.append({"idx": i, "company": name, "domain": dom, "industry": icp.industries[0].value.name, "naics": icp.industries[0].value.naics,
                          "headcount": None, "hq": None, "signal_type": "job_post" if is_job else "launch", "summary": r["title"][:140],
                          "quote": _first_sentence(r["content"]), "date": None, "persona_title": None})
        return {"items": items}

    payload = [{"idx": i, "title": r["title"], "url": r["url"], "content": r["content"][:700]} for i, r in enumerate(uniq)]
    data, _ = llm.json_call("discovery", EXTRACT_SYSTEM, f"ICP: {icp.model_dump_json()[:1500]}\nResults: {json.dumps(payload)}", fb)
    added = 0
    for it in data.get("items", []):
        try:
            r = uniq[int(it["idx"])]
        except Exception:
            continue
        src = Source(url=r["url"], title=r["title"], quote=it.get("quote") or "", fetched_at=thinking.now(), verified=False)
        validator.validate(src)
        if not src.verified:
            state.dropped_claims.append({"claim": it.get("summary", ""), "company": it.get("company"), **src.model_dump()})
            continue
        name = (it.get("company") or "").strip()
        if not name:
            continue
        cid = "co_" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        sig = Signal(id=state.new_id("sig"), company_id=cid, type=it.get("signal_type") if it.get("signal_type") in SIGNAL_STRENGTH else "job_post",
                     summary=it.get("summary") or r["title"], date=it.get("date") or TODAY().isoformat(), source=src)
        with state.lock:
            if cid in state.companies:
                state.companies[cid].signals.append(sig)
                c = state.companies[cid]
            else:
                c = Company(id=cid, name=name, domain=(it.get("domain") or _company_from_url(r["url"], r["title"])[1]).replace("https://", "").strip("/"),
                            industry=it.get("industry") or "", naics=it.get("naics") or "", headcount=int(it.get("headcount") or 50), hq=it.get("hq") or "—",
                            fit=0, intent=0, score=0, tier="C", signals=[sig], competitors_used=[], sources=[src])
                state.companies[cid] = c
                ptitle = it.get("persona_title") or (icp.personas[0].value.title if icp.personas else "Head of Engineering")
                pid = state.new_id("p")
                state.people[pid] = Person(id=pid, company_id=cid, name=f"{ptitle} (to find)", title=ptitle,
                                           seniority=icp.personas[0].value.seniority if icp.personas else "", sources=[src])
                from . import pipeline
                pipeline.create_lead(pid, cid)
                graph.upsert_person(pid, state.people[pid].name, ptitle, None)
                added += 1
        graph.upsert_company(c)
        if c.id in {p.company_id for p in state.people.values()}:
            for p in state.people.values():
                if p.company_id == c.id:
                    graph.upsert_person(p.id, p.name, p.title, c.id)
    return added


def run() -> dict:
    icp = state.icp
    thinking.emit("planner", "handoff", "Planner → Discovery: find accounts + job posts matching the ICP")
    added = 0
    if live() and icp:
        added = discover_live(icp)
    else:
        thinking.emit("discovery", "search", "No TAVILY_API_KEY / SERPER_API_KEY — using the seeded Tenki demo dataset")
        from . import seed
        seed.replay_validation()
    since = date.fromordinal(TODAY().toordinal() - 30).isoformat()
    hiring = graph.hiring_signals(since)
    thinking.emit("discovery", "reason", f"{len(hiring)} companies posted relevant jobs in the last 30 days")
    rescore_all()
    tiers = {"A": 0, "B": 0, "C": 0}
    for c in state.companies.values():
        tiers[c.tier] += 1
    thinking.emit("discovery", "reason", f"Scored {len(state.companies)} accounts (fit 0–60 + intent 0–40): A={tiers['A']} B={tiers['B']} C={tiers['C']}")
    state.log("ai", "discovered", f"{added} new accounts; {len(state.companies)} total; {len(state.dropped_claims)} claims dropped", agent="discovery")
    return {"added": added, "total": len(state.companies), "tiers": tiers, "dropped": len(state.dropped_claims), "hiring": hiring,
            "companies": [c.model_dump() for c in sorted(state.companies.values(), key=lambda c: -c.score)]}
