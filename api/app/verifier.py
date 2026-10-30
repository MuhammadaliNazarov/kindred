"""Rule-based copy verifier (RLVR reward). The SAME function scores drafts in the HITL Reviewer gate and is the
GRPO reward in api/rl/grpo_outreach.py, so "the HITL verifier is the GRPO reward" is literally true.

Dependency-free on purpose (only stdlib) so the RL script can import it on a GPU box.
Max score = 4.5: company 1 + signal 1 + question CTA 1 + length 0.5 + claim sourced 1.
Penalties: outcome-guarantee words -2, any non-allowed link -1.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

MAX_SCORE = 4.5
BANNED = re.compile(r"\b(guarantee[ds]?|guaranteed|100%|risk[- ]free|promise[ds]?|zero risk|never fail)\b", re.I)
URL_RE = re.compile(r"https?://[^\s)>\]]+", re.I)
STOP = set("the a an and or to of in on for at by with is are was were be this that it its your you we our i from as about".split())
CLAIM_HINT = re.compile(r"\d|raised|hiring|hired|launch|announc|post|migrat|series|seed|funding|joined|outage|pricing", re.I)
SIGNOFF = re.compile(r"^\s*(—|--|-|–|cheers|best|thanks)\b", re.I)


def _words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9$%]+", s.lower()) if w not in STOP and len(w) > 2}


def _strip_signoff(text: str) -> str:
    """Drop trailing sign-off lines ("— Ali") and a trailing bare URL so the CTA check sees the real last sentence."""
    lines = [l for l in text.strip().splitlines() if l.strip()]
    while lines and (SIGNOFF.match(lines[-1]) or (len(lines[-1].split()) <= 2 and not lines[-1].strip().endswith("?"))):
        lines.pop()
    out = "\n".join(lines).strip()
    return URL_RE.sub("", out).strip() if out else text.strip()


def checks(text: str, company: str, signal: str, context: str | None = None,
           allowed_domains: list[str] | None = None) -> list[dict]:
    low = text.lower()
    words = len(text.split())
    sig_words = [w for w in _words(signal)]
    signal_hit = any(w in low for w in signal.lower().split()[-3:] if len(w) > 2) or (
        len(sig_words) > 0 and len(_words(text) & set(sig_words)) >= max(1, min(2, len(sig_words) // 3)))
    # claim has a source: every factual-looking sentence overlaps >= 40% with the source context
    ctx = _words((context or "") + " " + signal + " " + company)
    unsupported = []
    for s in re.split(r"(?<=[.!?])\s+|\n+", text):
        s = s.strip()
        if not s or not CLAIM_HINT.search(s) or URL_RE.fullmatch(s):
            continue
        w = _words(URL_RE.sub("", s))
        if w and len(w & ctx) / len(w) < 0.4:
            unsupported.append(s[:80])
    allowed = {d.lower().replace("www.", "") for d in (allowed_domains or []) if d}
    bad_links = []
    for u in URL_RE.findall(text):
        host = urlparse(u).netloc.lower().replace("www.", "")
        if allowed and not any(host == d or host.endswith("." + d) for d in allowed):
            bad_links.append(host)
    return [
        {"name": "company mentioned", "pass": bool(company) and company.lower() in low, "weight": 1.0},
        {"name": "cites the signal", "pass": bool(signal_hit), "weight": 1.0},
        {"name": "ends with a question CTA", "pass": _strip_signoff(text).endswith("?"), "weight": 1.0},
        {"name": f"30–90 words ({words})", "pass": 30 <= words <= 90, "weight": 0.5, "fail_weight": -0.5},
        {"name": "every claim has a source", "pass": not unsupported, "weight": 1.0,
         "detail": " | ".join(unsupported) or None},
        {"name": "no outcome guarantees", "pass": not BANNED.search(text), "weight": 0.0, "fail_weight": -2.0},
        {"name": "links only to allowed domains", "pass": not bad_links, "weight": 0.0, "fail_weight": -1.0,
         "detail": ", ".join(bad_links) or None},
    ]


def verify(text: str, company: str, signal: str, context: str | None = None,
           allowed_domains: list[str] | None = None) -> dict:
    cs = checks(text, company, signal, context, allowed_domains)
    s = sum(c["weight"] if c["pass"] else c.get("fail_weight", 0.0) for c in cs)
    return {"score": round(s, 2), "max": MAX_SCORE,
            "checks": [{k: v for k, v in c.items() if k in ("name", "pass", "detail") and v is not None} for c in cs]}


def score(text: str, company: str, signal: str, context: str | None = None,
          allowed_domains: list[str] | None = None) -> float:
    """Scalar reward (used by GRPO)."""
    return verify(text, company, signal, context, allowed_domains)["score"]
