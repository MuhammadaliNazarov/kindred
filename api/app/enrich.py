"""Enrichment waterfall: Hunter (email-finder + verifier/MX) → Apollo → free DNS tier. Gated by Flexprice credits.

The free tier needs no paid key and only claims what it can prove: the company domain resolves and has real MX records
(live DNS via dnspython). It never invents an email: email stays null, email_status "unknown", and a name-pattern
guess is exposed only as `pattern_guess`, explicitly labelled as an unverified guess.
"""
from __future__ import annotations

import hashlib
import os
import re

import dns.exception
import dns.resolver
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


def _clean_domain(raw: str) -> str:
    d = (raw or "").strip().lower()
    d = re.sub(r"^[a-z]+://", "", d).split("/")[0].split("?")[0].split(":")[0]
    return d[4:] if d.startswith("www.") else d


def _dns(domain: str, rtype: str) -> list | None:
    """Live lookup. [] = authoritative no-record (NXDOMAIN/NoAnswer); None = could not check (timeout/network)."""
    try:
        return list(dns.resolver.resolve(domain, rtype, lifetime=5.0))
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return []
    except (dns.exception.DNSException, OSError):
        return None


def _free(p: Person, raw_domain: str) -> Enrichment:
    """No-key tier: verify domain + MX for real; never fabricate or 'verify' an email."""
    domain = _clean_domain(raw_domain)
    thinking.emit("enricher", "search", f"Free tier: DNS lookup {domain} (A + MX)")
    a = _dns(domain, "A")
    if a == []:
        a = _dns(domain, "AAAA")
    resolves = None if a is None else bool(a)
    mx = _dns(domain, "MX")
    hosts = [str(r.exchange).rstrip(".") for r in sorted(mx or [], key=lambda r: r.preference)]
    hosts = [h for h in hosts if h]  # RFC 7505 null MX ("." ) = domain explicitly accepts no mail
    mx_ok: bool | None = None if mx is None else bool(hosts)
    guess = None
    first, last = _split(p.name)
    if mx_ok and "(to find)" not in p.name and " @ " not in p.name and first and last:
        f, l = (re.sub(r"[^a-z]", "", x.lower()) for x in (first, last))
        if f and l:
            guess = f"{f}.{l}@{domain} (GUESS: common pattern, not verified)"
    mx_txt = f"MX verified ({', '.join(hosts[:2])})" if mx_ok else ("no MX records" if mx_ok is False else "MX not checked (DNS error)")
    verification = f"domain {'resolves' if resolves else 'does not resolve' if resolves is False else 'not checked'}; {mx_txt}; mailbox NOT verified (no Hunter/Apollo key)"
    thinking.emit("enricher", "validate", f"{domain}: {verification}")
    return Enrichment(email=None, email_status="unknown", mx_ok=mx_ok, linkedin_url=None, provider="dns", confidence=0.0,
                      domain=domain, domain_resolves=resolves, mx_hosts=hosts, pattern_guess=guess, verification=verification)


def _seed(p: Person, domain: str) -> Enrichment:
    """Offline demo only (ENRICH_SEED=1). Fabricated data: never the default path."""
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
    thinking.emit("planner", "handoff", f"Planner → Enricher: {p.name} @ {co.domain or co.name}")
    if not co.domain:
        raise HTTPException(422, "company domain unknown (not found on the source page); enrichment refused rather than guessed")
    if not any(s.verified for s in co.sources + [g.source for g in co.signals]) and not co.domain.endswith("example.com"):
        raise HTTPException(422, "lead has no verified source; enrichment refused")
    e = _hunter(p, co.domain) or _apollo(p, co.domain)
    if e is None and os.getenv("ENRICH_SEED") == "1":
        thinking.emit("enricher", "reason", "ENRICH_SEED=1 — using seeded (fabricated) demo enrichment")
        e = _seed(p, co.domain)
    if e is None:
        thinking.emit("enricher", "reason", "No HUNTER/APOLLO result — free tier: verify domain + MX only, no email claimed")
        e = _free(p, co.domain)
    p.enrichment = e
    billing.meter("lead_enriched", lead_id=lead_id, provider=e.provider)  # fired only after validation + enrichment succeed
    mx = "ok" if e.mx_ok else "fail" if e.mx_ok is False else "?"
    msg = (f"{p.name}: {e.email} ({e.email_status}, MX {mx}) via {e.provider}" if e.email
           else f"{p.name} @ {e.domain or co.domain}: no email claimed (unknown), MX {mx} via {e.provider}")
    state.log("ai", "enriched", msg, agent="enricher", lead_id=lead_id)
    from . import graph
    graph.upsert_person(p.id, p.name, p.title, co.id)
    return p
