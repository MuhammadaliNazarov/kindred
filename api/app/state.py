"""In-memory app state (the graph lives in Kùzu; everything else here)."""
from __future__ import annotations

import itertools
import threading
from typing import Optional

from .models import ICP, AuditEvent, Company, ExpansionSegment, Intake, Lead, Person, Signal, Source, Touch
from .thinking import now

lock = threading.RLock()

intake: Optional[Intake] = None
icp: Optional[ICP] = None
expansions: dict[str, ExpansionSegment] = {}
companies: dict[str, Company] = {}
people: dict[str, Person] = {}
leads: dict[str, Lead] = {}
touches: dict[str, Touch] = {}
audit: list[AuditEvent] = []
dropped_claims: list[dict] = []  # claims whose quote was not found at the URL (verified:false), for a "show dropped" view

_ids = itertools.count(1)


def new_id(prefix: str) -> str:
    return f"{prefix}{next(_ids)}"


def log(actor: str, action: str, detail: str, agent: str | None = None, lead_id: str | None = None) -> AuditEvent:
    ev = AuditEvent(id=new_id("ev"), at=now(), actor=actor, agent=agent, action=action, lead_id=lead_id, detail=detail)
    with lock:
        audit.append(ev)
    return ev


def lead_sources(lead: Lead) -> list[Source]:
    co = companies.get(lead.company_id)
    p = people.get(lead.person_id)
    out: list[Source] = []
    if co:
        out += co.sources + [s.source for s in co.signals]
    if p:
        out += p.sources
    return out


def best_signal(company: Company) -> Optional[Signal]:
    if not company.signals:
        return None
    rank = {"job_post": 6, "funding": 5, "exec_hire": 4, "launch": 3, "tech_change": 3, "churn_risk": 2}
    return sorted(company.signals, key=lambda s: (s.source.verified, rank.get(s.type, 0), s.date), reverse=True)[0]
