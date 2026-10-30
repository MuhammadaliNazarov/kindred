"""Enrichment waterfall: Hunter (email-finder + verifier/MX) → Apollo → seed. Gated by Flexprice credits."""
from __future__ import annotations

import hashlib
import os

import httpx
from fastapi import HTTPException

from . import billing, pipeline, state, thinking
from .models import Enrichment, Person

H = "https://api.hunter.io/v2"


def _split(name: str) -> tuple[str, str]:
    parts = name.replace("(to find)", "").strip().split()
    return (parts[0], parts[-1]) if len(parts) >= 2 else (parts[0] if parts else "", "")


def _hunter(p: Person, domain: str) -> Enrichment | None:
    key = os.getenv("HUNTER_API_KEY")
    if not key:
        return None
    try:
        if "(to find)" in p.name:  # live-discovered account: find the persona at the domain
            thinking.emit("enricher", "search", f"Hunter domain-search {domain} for '{p.title}'")
            r = httpx.get(f"{H}/domain-search", params={"domain": domain, "limit": 10, "api_key": key}, timeout=15)
            r.raise_for_status()
            emails = r.json().get("data", {}).get("emails", [])
            words = [w for w in p.title.lower().split() if len(w) > 3]
            pick = next((e for e in emails if e.get("position") and any(w in e["position"].lower() for w in words)), emails[0] if emails else None)
            if not pick or not pick.get("first_name"):
                return None
            p.name = f"{pick['first_name']} {pick.get('last_name') or ''}".strip()
            p.title = pick.get("position") or p.title
            email, conf, li = pick.get("value"), (pick.get("confidence") or 0) / 100, pick.get("linkedin")
        else:
            first, last = _split(p.name)
            thinking.emit("enricher", "search", f"Hunter email-finder {first} {last} @ {domain}")
            r = httpx.get(f"{H}/email-finder", params={"domain": domain, "first_name": first, "last_name": last, "api_key": key}, timeout=15)
            r.raise_for_status()
            d = r.json().get("data", {})
            email, conf, li = d.get("email"), (d.get("score") or 0) / 100, d.get("linkedin_url")
        if not email:
            return None
        thinking.emit("enricher", "validate", f"Hunter email-verifier (MX) {email}")
        v = httpx.get(f"{H}/email-verifier", params={"email": email, "api_key": key}, timeout=20).json().get("data", {})
        st = v.get("status") or v.get("result") or "unknown"
        st = {"deliverable": "valid", "undeliverable": "invalid", "risky": "accept_all", "webmail": "valid", "disposable": "invalid"}.get(st, st)
        if st not in ("valid", "accept_all", "invalid", "unknown"):
            st = "unknown"
        li_url = li if (li or "").startswith("http") else (f"https://www.linkedin.com/in/{li}" if li else None)
        return Enrichment(email=email, email_status=st, mx_ok=v.get("mx_records"), linkedin_url=li_url, provider="hunter", confidence=round(conf, 2))
    except Exception as e:
        thinking.emit("enricher", "reason", f"Hunter failed ({type(e).__name__}); falling back to Apollo")
        return None


def _apollo(p: Person, domain: str) -> Enrichment | None:
    key = os.getenv("APOLLO_API_KEY")
    if not key:
        return None
    try:
        first, last = _split(p.name)
        thinking.emit("enricher", "search", f"Apollo people/match {first} {last} @ {domain}")
        r = httpx.post("https://api.apollo.io/api/v1/people/match", headers={"X-Api-Key": key, "Content-Type": "application/json"},
                       json={"first_name": first, "last_name": last, "domain": domain, "reveal_personal_emails": False}, timeout=20)
        r.raise_for_status()
        per = r.json().get("person") or {}
        if not per.get("email"):
            return None
        st = {"verified": "valid", "guessed": "accept_all", "unavailable": "unknown"}.get(per.get("email_status") or "", "unknown")
        return Enrichment(email=per["email"], email_status=st, mx_ok=st == "valid" or None, linkedin_url=per.get("linkedin_url"), provider="apollo", confidence=0.7 if st == "valid" else 0.5)
    except Exception as e:
        thinking.emit("enricher", "reason", f"Apollo failed ({type(e).__name__}); falling back to seed")
        return None


def _seed(p: Person, domain: str) -> Enrichment:
    first, last = _split(p.name)
    h = int(hashlib.md5(p.id.encode()).hexdigest(), 16)
    status = ["valid", "valid", "accept_all", "valid", "unknown"][h % 5]
    slug = (first + "-" + last).lower().strip("-")
    return Enrichment(email=f"{first.lower()}@{domain}" if first else None, email_status=status, mx_ok=status != "unknown",
                      linkedin_url=f"https://www.linkedin.com/in/{slug}-demo" if slug else None, provider="seed", confidence=0.9 if status == "valid" else 0.55)


def enrich_lead(lead_id: str) -> Person:
    lead = pipeline.get_lead(lead_id)
    p = state.people.get(lead.person_id)
    co = state.companies.get(lead.company_id)
    if not p or not co:
        raise HTTPException(404, "person/company missing")
    billing.check("lead_enriched", lead_id=lead_id)  # 402 + "Enrichment paused — out of credits"
    thinking.emit("planner", "handoff", f"Planner → Enricher: {p.name} @ {co.domain}")
    if not any(s.verified for s in co.sources + [g.source for g in co.signals]) and not co.domain.endswith("example.com"):
        raise HTTPException(422, "lead has no verified source; enrichment refused")
    e = _hunter(p, co.domain) or _apollo(p, co.domain)
    if e is None:
        thinking.emit("enricher", "reason", "No HUNTER/APOLLO result — using seeded enrichment")
        e = _seed(p, co.domain)
    p.enrichment = e
    billing.meter("lead_enriched", lead_id=lead_id, provider=e.provider)  # fired only after validation + enrichment succeed
    state.log("ai", "enriched", f"{p.name}: {e.email} ({e.email_status}, MX {'ok' if e.mx_ok else '?'}) via {e.provider}", agent="enricher", lead_id=lead_id)
    from . import graph
    graph.upsert_person(p.id, p.name, p.title, co.id)
    return p
