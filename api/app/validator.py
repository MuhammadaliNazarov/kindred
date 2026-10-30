"""No-hallucination rule in code: fetch each source URL and check the quoted text appears (normalised)."""
from __future__ import annotations

import html
import ipaddress
import re
import socket
import unicodedata
from urllib.parse import urlparse

import httpx

from . import thinking
from .models import Source

_cache: dict[str, str | None] = {}
_CACHE_MAX = 512
_MAX_BYTES = 2_000_000
UA = {"User-Agent": "Mozilla/5.0 (Warmpath quote validator; +https://example.com)"}


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


def page_text(url: str) -> str | None:
    if url in _cache:
        return _cache[url]
    text = None
    try:
        raw = _fetch(url)
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
