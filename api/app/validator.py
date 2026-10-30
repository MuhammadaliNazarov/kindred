"""No-hallucination rule in code: fetch each source URL and check the quoted text appears (normalised)."""
from __future__ import annotations

import html
import ipaddress
import re
import socket
import unicodedata
from urllib.parse import urlparse

import os

import httpx

from . import thinking
from .models import Source

_cache: dict[str, str | None] = {}
_xcache: dict[str, str | None] = {}  # Tavily-extract text per URL (JS-rendered job boards, bot-blocked pages)
_CACHE_MAX = 512
_MAX_BYTES = 2_000_000
UA = {"User-Agent": "Mozilla/5.0 (Kindred quote validator; +https://example.com)"}


def norm(s: str) -> str:
    s = html.unescape(s)
    s = unicodedata.normalize("NFKC", s).lower()
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    s = re.sub(r"[^a-z0-9$%]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _public_url(url: str) -> bool:
    """SSRF guard: http(s) only, and every resolved IP must be public (no private/loopback/link-local/metadata)."""
    try:
        u = urlparse(url)
        if u.scheme not in ("http", "https") or not u.hostname:
            return False
        for info in socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80)):
            ip = ipaddress.ip_address(info[4][0].split("%")[0])
            if not ip.is_global or ip.is_multicast or ip.is_reserved:
                return False
        return True
    except Exception:
        return False


def _fetch(url: str) -> str | None:
    with httpx.Client(headers=UA, timeout=4, follow_redirects=False) as c:
        for _ in range(4):  # original + at most 3 redirects, each re-checked
            if not _public_url(url):
                return None
            with c.stream("GET", url) as r:
                if r.is_redirect and r.headers.get("location"):
                    url = str(r.url.join(r.headers["location"]))
                    continue
                if r.status_code >= 400:
                    return None
                buf = bytearray()
                for chunk in r.iter_bytes():
                    buf += chunk
                    if len(buf) >= _MAX_BYTES:
                        break
                return bytes(buf[:_MAX_BYTES]).decode(r.encoding or "utf-8", errors="replace")
    return None


_hcache: dict[str, str | None] = {}  # raw HTML per URL (for link extraction, e.g. the company's own site on a job post)
_HCACHE_MAX = 128


def page_html(url: str) -> str | None:
    """Raw HTML of the page (direct fetch, cached); None when it could not be fetched."""
    if url in _hcache:
        return _hcache[url]
    try:
        raw = _fetch(url)
    except Exception:
        raw = None
    if len(_hcache) >= _HCACHE_MAX:
        _hcache.pop(next(iter(_hcache)), None)
    _hcache[url] = raw
    return raw


def page_text(url: str) -> str | None:
    if url in _cache:
        return _cache[url]
    text = None
    try:
        raw = page_html(url)
        if raw is not None:
            body = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", raw)
            text = norm(re.sub(r"(?s)<[^>]+>", " ", body))
    except Exception:
        text = None
    if len(_cache) >= _CACHE_MAX:
        try:
            _cache.pop(next(iter(_cache)), None)
        except Exception:
            _cache.clear()
    _cache[url] = text
    return text


def quote_found(quote: str, text: str) -> bool:
    frags = [norm(f) for f in re.split(r"\.\.\.|…", quote) if len(norm(f)) >= 12]
    if not frags:
        return False
    best = max(frags, key=len)
    if best in text:
        return True
    # tolerate snippet trimming: any 8-word window of the longest fragment
    words = best.split()
    if len(words) >= 8:
        return any(" ".join(words[i : i + 8]) in text for i in range(0, len(words) - 7))
    return False


def _cache_put(cache: dict, url: str, text: str | None) -> None:
    if len(cache) >= _CACHE_MAX:
        cache.pop(next(iter(cache)), None)
    cache[url] = text


def extract_text(url: str) -> str | None:
    """Second opinion when a direct fetch fails or is JS-rendered: Tavily Extract (API key if set, else keyless mode).
    Tavily fetches the live page itself, so a quote found here is still a quote found on the real page."""
    if url in _xcache:
        return _xcache[url]
    if not _public_url(url) or os.getenv("TAVILY_KEYLESS", "1") == "0" and not os.getenv("TAVILY_API_KEY"):
        return None
    text = None
    key = os.getenv("TAVILY_API_KEY")
    modes = ([{"Authorization": f"Bearer {key}"}] if key else []) + [{"X-Tavily-Access-Mode": "keyless"}]
    for hdr in modes:
        try:
            r = httpx.post("https://api.tavily.com/extract", headers=hdr, json={"urls": [url], "extract_depth": "basic"}, timeout=25)
            r.raise_for_status()
            res = r.json().get("results") or []
            if res and res[0].get("raw_content"):
                text = norm(res[0]["raw_content"])
                break
        except Exception:
            continue
    _cache_put(_xcache, url, text)
    return text


def page_contains(url: str, needle: str) -> bool:
    """True when `needle` (e.g. a person's name) appears on the page at url (direct fetch, then Tavily Extract)."""
    n = norm(needle)
    if len(n) < 4:
        return False
    for get in (page_text, extract_text):
        t = get(url)
        if t and n in t:
            return True
    return False


def validate(src: Source, agent: str = "discovery") -> Source:
    text = page_text(src.url)
    ok = bool(text) and quote_found(src.quote, text)
    via = "direct fetch"
    if not ok:
        xt = extract_text(src.url)
        if xt and quote_found(src.quote, xt):
            ok, text, via = True, xt, "Tavily extract"
        elif text is None:
            text = xt
    src.verified = ok
    src.fetched_at = thinking.now()
    if ok:
        thinking.emit(agent, "validate", f"Verified quote at {src.url} ({via})")
    elif text is None:
        thinking.emit(agent, "validate", f"Dropped: could not fetch {src.url}")
    else:
        thinking.emit(agent, "validate", f"Dropped: quote not found at {src.url}")
    return src
