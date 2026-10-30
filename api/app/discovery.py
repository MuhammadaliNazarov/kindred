"""Discovery: Tavily (→ Serper → seed) search for companies + job posts matching the ICP, quote validation, scoring."""
from __future__ import annotations

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

import httpx

from . import graph, llm, state, thinking, validator
from .models import ICP, Company, Person, Signal, Source

JOB_BOARDS = {"jobs.ashbyhq.com", "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "apply.workable.com", "wellfound.com", "www.ycombinator.com"}
TODAY = date.today


# ---------------- search ----------------
AGGREGATORS = ["linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com", "emploive.com", "builtin.com", "simplyhired.com",
               "jooble.org", "talent.com", "monster.com", "careerbuilder.com", "wellfound.com", "remoterocketship.com", "jobgether.com", "news.ycombinator.com"]


def _tavily(query: str, n: int, extra: dict) -> list[dict]:
    key = os.getenv("TAVILY_API_KEY")
    modes = ([("key", {"Authorization": f"Bearer {key}"})] if key else []) + ([("keyless", {"X-Tavily-Access-Mode": "keyless"})] if tavily_keyless() else [])
    body = {"query": query[:380], "max_results": n, "search_depth": "basic", "topic": "general", "exclude_domains": AGGREGATORS, **extra}
    last = None
    for label, hdr in modes:
        try:
            thinking.emit("discovery", "search", f"Tavily{'' if label == 'key' else ' (keyless)'}: {query[:120]}")
            r = httpx.post("https://api.tavily.com/search", headers=hdr, json=body, timeout=25)
            r.raise_for_status()
            return [{"title": x.get("title", ""), "url": x["url"], "content": x.get("content", ""), "published": x.get("published_date") or ""}
                    for x in r.json().get("results", [])]
        except Exception as e:
            last = e
    raise last or RuntimeError("tavily disabled")


_CACHE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "search_cache.json")


def _cache_key(query: str, n: int, extra: dict) -> str:
    return json.dumps([query, n, extra], sort_keys=True)


def _cache_load() -> dict:
    try:
        with open(_CACHE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _cache_save(k: str, rows: list[dict]) -> None:
    """Last good results per query, so a demo still runs when the keyless hourly cap (429) is hit. Real pages, re-validated each run."""
    if not rows:
        return
    try:
        with state.lock:
            d = _cache_load()
            d[k] = rows
            os.makedirs(os.path.dirname(_CACHE_FILE), exist_ok=True)
            with open(_CACHE_FILE, "w") as f:
                json.dump(d, f)
    except Exception:
        pass


def search(query: str, n: int = 6, **extra) -> list[dict]:
    """Returns [{title,url,content,published}] from Tavily (key, then keyless), else Serper, else [].
    extra: Tavily params such as include_domains, topic='news', time_range='month'."""
    if os.getenv("TAVILY_API_KEY") or tavily_keyless():
        k = _cache_key(query, n, extra)
        try:
            rows = _tavily(query, n, extra)
            _cache_save(k, rows)
            return rows
        except Exception as e:
            cached = _cache_load().get(k)
            if cached:
                thinking.emit("discovery", "search", f"Tavily unavailable ({type(e).__name__}); reusing last results for this query (quotes re-validated live)")
                return cached
            thinking.emit("discovery", "search", f"Tavily failed ({type(e).__name__}); trying Serper")
    if os.getenv("SERPER_API_KEY"):
        try:
            thinking.emit("discovery", "search", f"Serper: {query}")
            r = httpx.post("https://google.serper.dev/search", headers={"X-API-KEY": os.environ["SERPER_API_KEY"]}, json={"q": query, "num": n}, timeout=20)
            r.raise_for_status()
            return [{"title": x.get("title", ""), "url": x["link"], "content": x.get("snippet", ""), "published": x.get("date", "")} for x in r.json().get("organic", [])]
        except Exception as e:
            thinking.emit("discovery", "search", f"Serper failed ({type(e).__name__})")
    return []


def tavily_keyless() -> bool:
    """Tavily Search works without a key in keyless mode (rate-limited). On by default; TAVILY_KEYLESS=0 turns it off."""
    return os.getenv("TAVILY_KEYLESS", "1") != "0"


def live() -> bool:
    return bool(os.getenv("TAVILY_API_KEY") or tavily_keyless() or os.getenv("SERPER_API_KEY"))


def _first_sentence(text: str) -> str:
    text = re.sub(r"(?m)^\s*(#{1,6}|[-*>]|\d+\.)\s+", "", text)  # drop markdown heading/bullet markers
    text = re.sub(r"[*_`]{1,3}", "", text)
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


EVIDENCE_TERMS = ["agent", "sandbox", "code execution", "execute code", "untrusted code", "microvm", "firecracker", "infrastructure",
                  "platform engineer", "runtime", "isolat", "container", "kubernetes", "rl environment", "eval", "llm", "coding"]


def _evidence_fit(c: Company, icp: ICP | None) -> int:
    """0-16: how many ICP terms the verified quotes/summaries actually contain (fit read from the evidence, not guessed)."""
    text = " ".join(f"{g.summary} {g.source.quote} {g.source.title}" for g in c.signals if g.source.verified).lower()
    if not text:
        return 0
    terms = set(EVIDENCE_TERMS)
    if icp:
        for t in icp.triggers:
            terms |= {w for w in re.findall(r"[a-z]{6,}", t.value.description.lower())}
    return min(20, 4 * sum(1 for t in terms if t in text))


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
        if c.headcount is None:
            fit += 8  # unknown size (not stated in the evidence): neutral, never a penalty
        elif sz.min_headcount <= c.headcount <= sz.max_headcount:
            fit += 16
        elif c.headcount <= sz.max_headcount * 3:
            fit += 6
        ptitles = " ".join(p.value.title.lower() for p in icp.personas)
        if any(any(w in ptitles for w in p.title.lower().split() if len(w) > 3) for p in people):
            fit += 10
    cited = {s.url for s in c.sources + [g.source for g in c.signals] if s.url and s.verified}
    fit += min(16, 8 * len(cited))  # only page-verified citations count
    fit += _evidence_fit(c, icp)
    fit = min(60, round(60 * fit / 84))  # scale the raw evidence points (max ~84) so leads spread instead of all capping at 60
    intent = 0.0
    for s in c.signals:
        rec = max(0.0, 1 - _days_ago(s.date) / 60)
        intent = max(intent, 34 * SIGNAL_STRENGTH.get(s.type, 0.5) * rec)
    if any(s.source.verified for s in c.signals):
        intent += 6  # the 'why now' was found on the live page, not just claimed
    intent += min(6, 2 * max(0, len(c.signals) - 1))
    c.fit, c.intent = int(fit), int(min(40, round(40 * intent / 46)))  # raw intent max ~46
    c.score = c.fit + c.intent
    c.tier = "A" if c.score >= 75 else "B" if c.score >= 50 else "C"
    return c


def rescore_all() -> None:
    for c in state.companies.values():
        score(c, state.icp, [p for p in state.people.values() if p.company_id == c.id])
        graph.upsert_company(c)


# ---------------- live discovery ----------------
EXTRACT_SYSTEM = """You qualify B2B leads from web search results for the ICP given. For each result that is about ONE specific company
(its own job post, its own funding/launch news, its own blog) AND that company plausibly fits the ICP, return
{"items":[{"idx":int,"company":str,"domain":str|null,"industry":str,"naics":str,"headcount":int|null,"hq":str|null,
"signal_type":"job_post|funding|exec_hire|tech_change|launch","summary":str,"quote":str,"date":"YYYY-MM-DD"|null,
"buyer_name":str|null,"buyer_title":str|null,"fit_reason":str}]}.
Rules: `quote` MUST be copied character-for-character from that result's content (12-30 words, one contiguous span, no ellipses).
`buyer_name` only if a real person at that company is named in the content (founder, CTO, head of eng/infra/platform); never guess.
`buyer_title` = that person's title, or else the ICP persona this signal points to (e.g. "Head of Platform").
`date` only if stated in the content. `domain` is the company's own website domain, not the job board.
Skip: job aggregators, listicles/roundups covering many companies, the seller itself, its direct competitors, giant public companies
(over ~2000 staff), and anything that does not fit the ICP."""


def _company_from_url(url: str, title: str) -> tuple[str, str]:
    u = urlparse(url)
    host = u.netloc.lower()
    if host in JOB_BOARDS:
        slug = [p for p in u.path.split("/") if p][:1]
        slug = slug[0] if slug else host
        if host == "www.ycombinator.com":
            m = re.search(r"/companies/([^/]+)", u.path)
            slug = m.group(1) if m else slug
        slug = re.sub(r"-\d+$", "", slug)
        return slug.replace("-", " ").title(), f"{slug}.com"
    name = re.split(r" [-|–—] | at ", title)[-1].strip()[:40] if " at " in title or " - " in title else host.replace("www.", "").split(".")[0].title()
    return name, host.replace("www.", "")


NOT_COMPANY_HOSTS = {h.replace("www.", "") for h in JOB_BOARDS} | set(AGGREGATORS) | {
    "twitter.com", "x.com", "facebook.com", "instagram.com", "youtube.com", "github.com", "crunchbase.com", "google.com", "apple.com",
    "greenhouse.io", "ashbyhq.com", "lever.co", "workable.com", "ycombinator.com", "w3.org", "schema.org", "googleapis.com", "gstatic.com",
    "cloudfront.net", "amazonaws.com", "medium.com", "substack.com", "notion.so", "calendly.com", "mailto"}
_2LVL = {"co", "com", "org", "net", "ac", "gov", "edu"}


def _clean_domain(raw: str | None) -> str | None:
    d = (raw or "").strip().lower()
    d = re.sub(r"^[a-z]+://", "", d).split("/")[0].split("?")[0].split(":")[0]
    d = d[4:] if d.startswith("www.") else d
    return d if re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", d) else None


def _registrable(host: str) -> str:
    parts = host.split(".")
    if len(parts) > 2:
        parts = parts[-3:] if parts[-2] in _2LVL else parts[-2:]
    return ".".join(parts)


def _third_party(host: str) -> bool:
    return any(host == h or host.endswith("." + h) for h in NOT_COMPANY_HOSTS)


def _domain_from_page(raw: str, name: str) -> str | None:
    """The company's own site linked from the source page, matched to its name (exact label first, then contains)."""
    keys = {re.sub(r"[^a-z0-9]", "", k) for k in (name.lower(), name.lower().replace(".ai", "").split()[0] if name else "")}
    keys = {k for k in keys if len(k) >= 3}
    if not keys:
        return None
    exact, partial = [], []
    for m in re.finditer(r"https?://([a-z0-9.-]+\.[a-z]{2,})", raw, re.I):
        host = _registrable(m.group(1).lower())
        if _third_party(host):
            continue
        label = host.split(".")[0]
        if label in keys:
            exact.append(host)
        elif any(k in label or (len(label) >= 4 and label in k) for k in keys):
            partial.append(host)
    for lst in (exact, partial):
        if lst:
            return max(set(lst), key=lst.count)  # most-linked matching host
    return None


def resolve_domain(url: str, name: str, hinted: str | None) -> str | None:
    """Lowercase company domain from the evidence: the source page itself when it is the company's own site, else a link on that
    page to the company's site (an LLM-hinted domain counts only if the page links to it). Unknown stays None — never `name.com`."""
    host = urlparse(url).netloc.lower().replace("www.", "")
    if host and not _third_party(host) and not any(host == n or host.endswith("." + n) for n in NEWS):
        return _registrable(host)
    raw = (validator.page_html(url) or "").lower()
    hint = _clean_domain(hinted)
    if hint and hint in raw:
        return hint
    return _domain_from_page(raw, name)


ATS =["jobs.ashbyhq.com", "job-boards.greenhouse.io", "boards.greenhouse.io", "jobs.lever.co", "ycombinator.com", "apply.workable.com"]
NEWS = ["techcrunch.com", "businesswire.com", "prnewswire.com", "venturebeat.com", "siliconangle.com", "finsmes.com", "axios.com", "fortune.com"]


def _queries(icp: ICP) -> list[tuple[str, dict]]:
    """(query, tavily params). Job posts on ATS pages are the strongest free signal; funding/launch news second."""
    persona = icp.personas[0].value.title if icp.personas else "infrastructure engineer"
    ind = icp.industries[0].value.name if icp.industries else "AI agent startup"
    ind = re.sub(r"\s*\(.*?\)", "", ind)
    news = {"topic": "news", "time_range": "month", "include_domains": NEWS}
    qs: list[tuple[str, dict]] = [
        ("AI agents startup hiring infrastructure engineer sandboxes code execution", {"include_domains": ATS}),
        ("AI agent startup hiring platform engineer agent runtime isolated environments", {"include_domains": ATS}),
        (f"{ind} {persona} job microVM containers run untrusted agent code", {"include_domains": ATS}),
        ("AI agent startup raises seed Series A funding to build autonomous agents", news),
        ("startup launches AI coding agent that runs code in sandbox", news),
    ]
    for seg in state.expansions.values():
        if seg.status in ("accepted", "adjusted"):
            qs.append((f"{seg.name} startup hiring infrastructure engineer", {"include_domains": ATS}))
    return qs


HEADLINE = re.compile(r"^(?:exclusive:\s*)?([A-Z][\w.&'-]*(?:\s+[A-Z][\w.&'-]*){0,3})\s+(raises|launches|bags|secures|lands|unveils|announces|debuts|closes|releases|introduces)\b", re.I)
BIG = {"anthropic", "openai", "google", "microsoft", "meta", "amazon", "aws", "docker", "cohere", "mistral", "nvidia", "databricks",
       "thinkingmachines", "thinking machines", "apple", "ibm", "oracle", "salesforce", "stripe", "cloudflare", "github", "vercel"}


def _pub_date(r: dict) -> str | None:
    p = (r.get("published") or "").strip()
    if not p:
        return None
    try:
        return datetime.fromisoformat(p[:10]).date().isoformat()
    except Exception:
        pass
    try:
        return parsedate_to_datetime(p).date().isoformat()
    except Exception:
        return None


def _clean_date(d: str | None) -> str | None:
    try:
        x = datetime.fromisoformat(str(d)[:10]).date()
        return x.isoformat() if x <= TODAY() else None
    except Exception:
        return None


def _seller_names() -> set[str]:
    out = set()
    if state.intake:
        out.add(state.intake.product_name.lower())
        out.add(urlparse(state.intake.product_url).netloc.lower().replace("www.", "").split(".")[0])
    return {x for x in out if x} | {"e2b", "modal", "daytona", "tenki"}


def discover_live(icp: ICP) -> int:
    results = []
    with ThreadPoolExecutor(5) as ex:  # searches in parallel
        for rs in ex.map(lambda q: search(q[0], n=8, **q[1]), _queries(icp)):
            results += rs
    seen, uniq = set(), []
    for r in results:
        key = r["url"].split("?")[0].rstrip("/")
        if key not in seen and r.get("content"):
            seen.add(key)
            uniq.append(r)
    uniq = uniq[:30]  # cap: each kept claim costs a page fetch
    thinking.emit("discovery", "reason", f"{len(uniq)} candidate pages; extracting claims {{company, signal, url, verbatim quote}}")

    def fb():
        """No-LLM path: company from the ATS slug, or from a news headline ("X raises/launches ..."); anything else is skipped."""
        items = []
        for i, r in enumerate(uniq):
            host = urlparse(r["url"]).netloc.lower().replace("www.", "")
            is_job = host in {h.replace("www.", "") for h in JOB_BOARDS}
            if is_job:
                name, dom = _company_from_url(r["url"], r["title"])
                stype = "job_post"
                if host == "ycombinator.com" and "/jobs/" not in r["url"]:
                    continue
            else:
                m = HEADLINE.search(r["title"])
                if not m:
                    continue
                name = re.sub(r"^[\w.-]+-backed\s+", "", m.group(1)).strip()
                dom = ""
                stype = "funding" if m.group(2).lower() in ("raises", "secures", "bags", "lands", "closes") else "launch"
            low = name.lower().replace(".ai", "").strip()
            if low in BIG or low.split()[0] in BIG:
                continue
            # no LLM: industry/size are unknown, so fit has to come from the verified quote, not from assumed firmographics
            items.append({"idx": i, "company": name, "domain": dom, "industry": "Unclassified (no LLM)", "naics": "",
                          "headcount": None, "hq": None, "signal_type": stype, "summary": r["title"][:140],
                          "quote": _first_sentence(r["content"]), "date": None, "buyer_name": None, "buyer_title": None})
        return {"items": items}

    payload = [{"idx": i, "title": r["title"], "url": r["url"], "published": r.get("published", ""), "content": r["content"][:900]} for i, r in enumerate(uniq)]
    data, _ = llm.json_call("discovery", EXTRACT_SYSTEM, f"Seller: {state.intake.model_dump_json()[:600] if state.intake else ''}\nICP: {icp.model_dump_json()[:1500]}\nResults: {json.dumps(payload)}", fb, max_tokens=6000)
    if not isinstance(data, dict):
        data = fb()
    sellers = _seller_names()
    pairs = []
    for it in data.get("items", []) or []:
        try:
            r = uniq[int(it["idx"])]
        except Exception:
            continue
        if not (it.get("company") or "").strip() or it["company"].strip().lower() in sellers:
            continue
        pairs.append((it, r, Source(url=r["url"], title=r["title"], quote=(it.get("quote") or "").strip(), fetched_at=thinking.now(), verified=False)))
    thinking.emit("discovery", "reason", f"{len(pairs)} claims extracted; validating every quote against its live page")
    with ThreadPoolExecutor(8) as ex:  # validate quotes in parallel, not one URL at a time
        list(ex.map(lambda x: validator.validate(x[2]), pairs))
    added = 0
    for it, r, src in pairs:
        if not src.verified:
            state.dropped_claims.append({"claim": it.get("summary", ""), "company": it.get("company"), **src.model_dump()})
            continue
        name = it["company"].strip()[:60]
        cid = "co_" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        stype = it.get("signal_type") if it.get("signal_type") in SIGNAL_STRENGTH else "job_post"
        sdate = _clean_date(it.get("date")) or _pub_date(r) or TODAY().isoformat()
        sig = Signal(id=state.new_id("sig"), company_id=cid, type=stype, summary=(it.get("summary") or r["title"])[:200], date=sdate, source=src)
        # buyer: a named person only if the name is on the verified page; otherwise a role with no name
        ptitle = (it.get("buyer_title") or (icp.personas[0].value.title if icp.personas else "Head of Engineering")).strip()[:80]
        bname = (it.get("buyer_name") or "").strip()
        named = bool(bname) and len(bname.split()) >= 2 and validator.page_contains(r["url"], bname)
        if bname and not named:
            thinking.emit("discovery", "validate", f"Dropped buyer name '{bname}': not on {r['url']}")
        with state.lock:
            new = cid not in state.companies
            if new:
                dom = resolve_domain(r["url"], name, it.get("domain"))
                if not dom:
                    thinking.emit("discovery", "validate", f"{name}: company domain not found on {r['url']} — left unknown (no guess)")
                hc = re.sub(r"\D", "", str(it.get("headcount") or ""))[:7]
                c = Company(id=cid, name=name, domain=dom, industry=it.get("industry") or "", naics=it.get("naics") or "",
                            headcount=int(hc) if hc and int(hc) > 0 else None,  # None = unknown (not stated in the evidence)
                            hq=it.get("hq") or "—", fit=0, intent=0, score=0, tier="C",
                            signals=[sig], competitors_used=[], sources=[src])
                state.companies[cid] = c
            else:
                c = state.companies[cid]
                if any(g.source.url == src.url for g in c.signals):
                    continue
                c.signals.append(sig)
                c.sources.append(src)
            existing = [p for p in state.people.values() if p.company_id == cid]
            person = None
            if named and not any(p.name == bname for p in existing):
                person = Person(id=state.new_id("p"), company_id=cid, name=bname, title=ptitle,
                                seniority=icp.personas[0].value.seniority if icp.personas else "", sources=[src])
            elif not existing:
                person = Person(id=state.new_id("p"), company_id=cid, name=f"{ptitle} @ {name}", title=ptitle,
                                seniority=icp.personas[0].value.seniority if icp.personas else "", sources=[src])
            if person:
                state.people[person.id] = person
                from . import pipeline
                pipeline.create_lead(person.id, cid)
        score(c, icp, [p for p in state.people.values() if p.company_id == cid])
        graph.upsert_company(c)
        for p in state.people.values():
            if p.company_id == cid:
                graph.upsert_person(p.id, p.name, p.title, cid)
        if new:
            added += 1
            thinking.emit("discovery", "reason", f"+ {name}: {stype.replace('_', ' ')} ({sdate}) — {it.get('fit_reason', '')[:120]}")
    return added


def run() -> dict:
    icp = state.icp
    thinking.emit("planner", "handoff", "Planner → Discovery: find accounts + job posts matching the ICP")
    added = 0
    if live() and icp:
        try:
            added = discover_live(icp)
        except Exception as e:
            thinking.emit("discovery", "reason", f"Live discovery failed ({type(e).__name__}: {str(e)[:100]}) — keeping demo data")
        from . import seed
        if any(not seed.is_seed(c.id) for c in state.companies.values()):
            seed.purge()  # real verified accounts exist: the fictional demo accounts leave the pipeline and graph
        else:
            seed.replay_validation()  # nothing real verified: the seeded demo accounts remain the fallback
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
