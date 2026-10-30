"""Company understanding before ICP: website (homepage + up to 5 key same-domain pages) + Tavily searches →
evidence pack [{url,title,quote}] → filled Intake + icp_hints (the company's own words about who it serves).
Cached per URL in data/cache/analyze_<hash>.json."""
from __future__ import annotations

import hashlib
import html as htmlmod
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin, urlparse

from . import discovery, llm, state, thinking, validator
from .models import Intake, Source

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "cache"
KEY_PATHS = ("about", "pricing", "price", "plans", "customers", "clients", "case-stud", "services", "solutions", "how-it-works",
             "product", "features", "who-we-serve", "founders", "startups", "blog", "faq")
AUDIENCE = re.compile(r"\b(?:built for|made for|designed for|for|helps?|helping|serving|serves|trusted by|loved by|empowers?|supporting)\s+"
                      r"((?:ambitious |early[- ]stage |high[- ]growth |global |busy |modern |fast[- ]growing )?"
                      r"(?:founders?|startups?|teams?|companies|businesses|entrepreneurs|developers|engineers|smbs?|enterprises?|"
                      r"agencies|creators|operators|investors|vcs?|immigrants|families|individuals|professionals|marketers|sales|"
                      r"[a-z]+ (?:founders|startups|teams|companies|businesses|leaders))[^.,;:!?|]{0,70})", re.I)
PRICE = re.compile(r"(?:[$£€]\s?\d[\d,]*(?:\.\d{2})?\s*(?:k|K)?(?:\s*(?:/|per)\s*(?:mo|month|year|yr|annum|user|seat|hour))?)")


def _cache_path(url: str) -> Path:
    return CACHE_DIR / f"analyze_{hashlib.sha1(url.lower().encode()).hexdigest()[:16]}.json"


def _norm_url(url: str) -> str:
    url = (url or "").strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    return url.rstrip("/")


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", htmlmod.unescape(re.sub(r"(?s)<[^>]+>", " ", s or ""))).strip()


def _parse_page(raw: str) -> dict:
    """Title, meta/og description, headings, list items and readable sentences (original case, verbatim)."""
    body = re.sub(r"(?is)<(script|style|noscript|svg|template)[^>]*>.*?</\1>", " ", raw)
    meta = lambda n: next((htmlmod.unescape(m.group(1)).strip() for m in re.finditer(
        r'<meta[^>]+(?:name|property)=["\']' + n + r'["\'][^>]*content=["\']([^"\']+)', raw, re.I)), "") or next(
        (htmlmod.unescape(m.group(1)).strip() for m in re.finditer(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:name|property)=["\']' + n + r'["\']', raw, re.I)), "")
    title = _clean((re.search(r"(?is)<title[^>]*>(.*?)</title>", raw) or [None, ""])[1])
    heads = [_clean(h) for _, h in re.findall(r"(?is)<(h[1-3])[^>]*>(.*?)</\1>", body)]
    lis = [_clean(x) for x in re.findall(r"(?is)<li[^>]*>(.*?)</li>", body)]
    paras = [_clean(x) for x in re.findall(r"(?is)<(?:p|h[1-4]|li|span|div)[^>]*>([^<]{25,600})<", body)]
    sents: list[str] = []
    for p in paras:
        sents += [x.strip() for x in re.split(r"(?<=[.!?])\s+", p) if 25 <= len(x.strip()) <= 260]
    seen, uniq = set(), []
    for s in sents:
        k = s.lower()
        if k not in seen:
            seen.add(k)
            uniq.append(s)
    return {"title": title, "description": meta("description") or meta("og:description"), "site_name": meta("og:site_name"),
            "headings": [h for h in heads if 3 <= len(h) <= 160][:30], "items": [x for x in lis if 3 <= len(x) <= 140][:40],
            "sentences": uniq[:120]}


def _links(raw: str, base: str) -> list[str]:
    host = urlparse(base).netloc.lower().replace("www.", "")
    out = []
    for href in re.findall(r'href=["\']([^"\'#]+)', raw, re.I):
        u = urljoin(base + "/", href.strip())
        pu = urlparse(u)
        if pu.scheme not in ("http", "https") or pu.netloc.lower().replace("www.", "") != host:
            continue
        path = pu.path.lower().rstrip("/")
        if not path or path.count("/") > 2 or re.search(r"\.(png|jpe?g|svg|pdf|css|js|ico|webp|xml)$", path):
            continue
        rank = next((i for i, k in enumerate(KEY_PATHS) if k in path), None)
        if rank is not None:
            out.append((rank, f"{pu.scheme}://{pu.netloc}{pu.path}".rstrip("/")))
    seen, pages = set(), []
    for _, u in sorted(out):
        if u not in seen and u != base:
            seen.add(u)
            pages.append(u)
    return pages[:5]


def _fetch_site(url: str) -> list[tuple[str, dict]]:
    raw = validator.page_html(url)  # SSRF-safe (public IPs only, redirects re-checked)
    if not raw:
        thinking.emit("icp", "search", f"Could not fetch {url} directly — trying Tavily Extract")
        xt = validator.extract_text(url)
        return [(url, {"title": "", "description": "", "site_name": "", "headings": [], "items": [], "sentences": []
                       , "_flat": xt or ""})] if xt else []
    pages = [(url, _parse_page(raw))]
    subs = _links(raw, url)
    thinking.emit("icp", "search", f"Website: {url} + {len(subs)} key pages {[urlparse(s).path for s in subs]}")
    with ThreadPoolExecutor(5) as ex:
        for u, r in zip(subs, ex.map(validator.page_html, subs)):
            if r:
                pages.append((u, _parse_page(r)))
    return pages


def _domain(url: str) -> str:
    return urlparse(url).netloc.lower().replace("www.", "")


def _search_pack(name: str, dom: str, context: str = "") -> list[Source]:
    qs = [f'"{name}" site:linkedin.com', f'"{name}" customers OR clients', f'"{name}" instagram', f'"{dom}" reviews']
    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(lambda q: discovery.search(q, n=4), qs))
    out: list[Source] = []
    key = name.lower().split()[0] if name else dom.split(".")[0]
    for rows in res:
        for r in rows[:3]:
            text = re.sub(r"\s+", " ", r.get("content") or "").strip()
            blob = (text + " " + r.get("title", "") + " " + r.get("url", "")).lower()
            if key not in blob:
                continue
            ctx = {w for w in re.findall(r"[a-z]{5,}", context.lower())} - {name.lower(), "about", "their", "which", "would", "there"}
            if dom not in blob and len(ctx & set(re.findall(r"[a-z]{5,}", blob))) < 3:
                continue  # same name, different company (e.g. "expedite" freight shipping)
            sents = [x for x in re.split(r"(?<=[.!?])\s+", text) if 30 <= len(x) <= 260] or ([text[:240]] if text else [])
            sents.sort(key=lambda x: -(key in x.lower()) - 0.5 * bool(AUDIENCE.search(x)))
            if sents:
                out.append(Source(url=r["url"], title=(r.get("title") or "")[:160], quote=sents[0][:240], fetched_at=thinking.now(), verified=False))
    seen, uniq = set(), []
    for s in out:
        if s.url not in seen:
            seen.add(s.url)
            uniq.append(s)
    return uniq[:10]


def _website_pack(pages: list[tuple[str, dict]]) -> list[Source]:
    """Verbatim quotes from the company's own pages (fetched by us just now → verified)."""
    out: list[Source] = []
    for url, p in pages:
        cands: list[str] = []
        if p.get("description"):
            cands.append(p["description"])
        cands += p.get("headings", [])[:4]
        cands += [s for s in p.get("sentences", []) if AUDIENCE.search(s) or PRICE.search(s)][:6]
        cands += p.get("sentences", [])[:3]
        if p.get("_flat"):
            cands += [x for x in re.split(r"(?<=[.!?])\s+", p["_flat"]) if 30 <= len(x) <= 240][:6]
        seen = set()
        for q in cands:
            q = q.strip()[:240]
            if len(q) < 12 or q.lower() in seen:
                continue
            seen.add(q.lower())
            out.append(Source(url=url, title=(p.get("title") or url)[:160], quote=q, fetched_at=thinking.now(), verified=not p.get("_flat")))
            if len([x for x in out if x.url == url]) >= 8:
                break
    return out[:30]


def _hints(pack: list[Source]) -> list[str]:
    hs: list[str] = []
    for s in pack:
        for m in AUDIENCE.finditer(s.quote):
            h = re.sub(r"^(?:built for|made for|designed for|for)\s+", "", m.group(0).strip(" -–—"), flags=re.I)
            if h.lower() not in [x.lower() for x in hs]:
                hs.append(h)
    return hs[:8]


def deterministic(url: str, name: str | None, description: str | None, pages: list[tuple[str, dict]], pack: list[Source]) -> dict:
    home = pages[0][1] if pages else {}
    title = home.get("title", "")
    pname = (name or home.get("site_name") or re.split(r"\s+[|\-–—:]\s+", title)[0] or _domain(url).split(".")[0].title()).strip()
    desc = description or home.get("description") or (home.get("headings") or [""])[0] or title
    feats = [h for p in pages for h in p[1].get("headings", [])[1:] if 3 <= len(h.split()) <= 10][:8]
    allq = " ".join(s.quote for s in pack)
    prices = PRICE.findall(allq)
    acv = None
    if prices:
        nums = [float(re.sub(r"[^\d.]", "", x) or 0) * (1000 if re.search(r"\d\s*[kK]", x) else 1) for x in prices]
        top = max(nums)
        acv = top * 12 if re.search(r"mo|month", prices[nums.index(top)], re.I) else top or None
    hints = _hints(pack)
    if description:
        hints = _hints([Source(url=url, title="", quote=description, fetched_at="", verified=False)]) + hints
    intake = Intake(product_name=pname, product_url=url, description=desc[:400], features=feats,
                    constraints=["Public data only"], reference_customers=[],
                    pricing_model=("Published prices: " + ", ".join(dict.fromkeys(prices))[:120]) if prices else "",
                    acv_usd=acv)
    return {"intake": intake.model_dump(), "icp_hints": list(dict.fromkeys(hints))[:8],
            "summary": f"{pname}: {desc[:220]}" + (f" Serves: {hints[0]}." if hints else "")}


ANALYZE_SYSTEM = """You are the Company Analyst of an evidence-first GTM engine. From the evidence pack (numbered quotes from the
company's own website and from web search), describe the SELLER company accurately. Use only what the evidence says; leave unknowns empty.
Return JSON: {"intake":{"product_name":str,"product_url":str,"description":str (1-2 sentences, their positioning),
"features":[str] (services/features they actually offer),"constraints":[str],"reference_customers":[str] (named customers/clients only),
"pricing_model":str,"acv_usd":number|null},
"icp_hints":[str] (who they say they serve, VERBATIM phrases from the evidence, e.g. "founders building across borders"),
"summary":str (3 sentences: what they sell, to whom, why now),
"hint_evidence":[int] (ids of the quotes that state the audience)}"""


def run(url: str, name: str | None = None, description: str | None = None, refresh: bool = False) -> dict:
    url = _norm_url(url)
    cp = _cache_path(url)
    if not refresh:
        try:
            out = json.loads(cp.read_text())
            if name and not out["intake"].get("product_name"):
                out["intake"]["product_name"] = name
            thinking.emit("icp", "reason", f"Company analysis for {url} loaded from cache")
            _remember(out)
            return out
        except Exception:
            pass
    thinking.emit("planner", "handoff", f"Planner → Company Analyst: understand {name or url} before building the ICP")
    pages = _fetch_site(url)
    web = _website_pack(pages)
    pname = name or (pages[0][1].get("site_name") if pages else "") or (re.split(r"\s+[|\-–—:]\s+", pages[0][1].get("title", ""))[0] if pages else "") or _domain(url).split(".")[0].title()
    ctx = " ".join([description or ""] + [s.quote for s in web[:6]])
    found = _search_pack(pname, _domain(url), ctx) if discovery.live() else []
    pack = web + found
    if description:  # the user's own words count as first-party evidence
        pack.insert(0, Source(url=url, title=f"{pname} (as described by the user)", quote=description[:240], fetched_at=thinking.now(), verified=False))
    thinking.emit("icp", "reason", f"Evidence pack: {len(web)} website quotes, {len(found)} web results")
    fb = lambda: deterministic(url, name, description, pages, pack)
    ev = [{"id": i, "url": s.url, "title": s.title, "quote": s.quote, "first_party": _domain(s.url) == _domain(url)} for i, s in enumerate(pack)]
    data, was_live = llm.json_call("icp", ANALYZE_SYSTEM, json.dumps({"url": url, "name": name, "user_description": description, "evidence": ev}), fb, max_tokens=3000)
    base = fb() if was_live else data
    try:
        merged = {**base["intake"], **{k: v for k, v in (data.get("intake") or {}).items() if v not in (None, "", [])}}
        merged["product_url"] = url
        if name:
            merged["product_name"] = name
        intake = Intake.model_validate(merged)
        hints = [h for h in (data.get("icp_hints") or []) if isinstance(h, str) and h.strip()] or base["icp_hints"]
        summary = data.get("summary") or base["summary"]
    except Exception as e:
        thinking.emit("icp", "reason", f"Analyst JSON invalid ({type(e).__name__}); using deterministic extraction")
        intake, hints, summary = Intake.model_validate(base["intake"]), base["icp_hints"], base["summary"]
    if description and not any(h.lower() in description.lower() for h in hints):
        hints = _hints([Source(url=url, title="", quote=description, fetched_at="", verified=False)]) + hints
    out = {"intake": intake.model_dump(), "evidence": [s.model_dump() for s in pack], "summary": summary,
           "icp_hints": list(dict.fromkeys(hints))[:8], "url": url, "live": was_live}
    if pages:  # don't cache a failed fetch
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cp.write_text(json.dumps(out, indent=1))
        except Exception:
            pass
    _remember(out)
    state.log("ai", "company_analyzed", f"{intake.product_name}: {len(pack)} evidence quotes, hints={out['icp_hints'][:3]}", agent="icp")
    return out


def _remember(out: dict) -> None:
    with state.lock:
        state.profile = out


def profile_for(intake: Intake) -> dict | None:
    """The analysis for this intake's domain (from memory or the disk cache), else None."""
    p = state.profile
    if p and _domain(p.get("url", "")) == _domain(_norm_url(intake.product_url)):
        return p
    try:
        return json.loads(_cache_path(_norm_url(intake.product_url)).read_text())
    except Exception:
        return None
