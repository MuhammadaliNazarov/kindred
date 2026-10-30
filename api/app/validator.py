"""No-hallucination rule in code: fetch each source URL and check the quoted text appears (normalised)."""
from __future__ import annotations

import html
import re
import unicodedata

import httpx

from . import thinking
from .models import Source

_cache: dict[str, str | None] = {}
UA = {"User-Agent": "Mozilla/5.0 (Warmpath quote validator; +https://example.com)"}


def norm(s: str) -> str:
    s = html.unescape(s)
    s = unicodedata.normalize("NFKC", s).lower()
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    s = re.sub(r"[^a-z0-9$%]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def page_text(url: str) -> str | None:
    if url in _cache:
        return _cache[url]
    text = None
    try:
        r = httpx.get(url, headers=UA, timeout=8, follow_redirects=True)
        if r.status_code < 400:
            body = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", r.text)
            text = norm(re.sub(r"(?s)<[^>]+>", " ", body))
    except Exception:
        text = None
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


def validate(src: Source, agent: str = "discovery") -> Source:
    text = page_text(src.url)
    ok = bool(text) and quote_found(src.quote, text)
    src.verified = ok
    src.fetched_at = thinking.now()
    if ok:
        thinking.emit(agent, "validate", f"Verified quote at {src.url}")
    elif text is None:
        thinking.emit(agent, "validate", f"Dropped: could not fetch {src.url}")
    else:
        thinking.emit(agent, "validate", f"Dropped: quote not found at {src.url}")
    return src
