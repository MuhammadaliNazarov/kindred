"""Leads, stage moves (actor ai/rep), audit log, analytics."""
from __future__ import annotations

from collections import defaultdict

from fastapi import HTTPException

from . import graph, state, thinking
from .models import STAGES, Lead

_variant_flip = [0]


def create_lead(person_id: str, company_id: str, stage: str = "matched", owner: str = "ai") -> Lead:
    _variant_flip[0] += 1
    lid = f"L{len(state.leads) + 1}"
    lead = Lead(id=lid, person_id=person_id, company_id=company_id, stage=stage, owner=owner,
                variant="A" if _variant_flip[0] % 2 else "B", updated_at=thinking.now())
    state.leads[lid] = lead
    return lead


def get_lead(lead_id: str) -> Lead:
    lead = state.leads.get(lead_id)
    if not lead:
        raise HTTPException(404, f"lead {lead_id} not found")
    return lead


def move(lead_id: str, stage: str, actor: str, agent: str | None = None, why: str = "") -> Lead:
    lead = get_lead(lead_id)
    old = lead.stage
    lead.stage, lead.owner, lead.updated_at = stage, actor, thinking.now()
    if stage == "replied":
        graph.add_replied(lead.person_id)
    _bandit_reward(lead, stage)
    state.log(actor, "stage_move", f"{old} → {stage}{(' · ' + why) if why else ''}", agent=agent, lead_id=lead_id)
    thinking.emit(agent or "rep", "handoff", f"Lead {lead_id}: {old} → {stage} by {actor}")
    return lead


def lead_arm(lead: Lead) -> str | None:
    ts = [t for t in state.touches.values() if t.lead_id == lead.id and t.arm]
    sent = [t for t in ts if t.status == "sent"]
    return (sent or ts)[0].arm if (sent or ts) else None


def _bandit_reward(lead: Lead, stage: str) -> None:
    """Reply = reward 1; closed_lost after a send without a reply = reward 0."""
    from . import bandit
    arm = lead_arm(lead)
    if not arm:
        return
    if stage in ("replied", "meeting", "closed_won"):
        bandit.update(arm, 1, lead_id=lead.id)
    elif stage == "closed_lost" and any(t.lead_id == lead.id and t.status == "sent" for t in state.touches.values()):
        bandit.update(arm, 0, lead_id=lead.id)


def _funnel(group: dict[str, list[Lead]], key: str) -> list[dict]:
    order = {s: i for i, s in enumerate(STAGES)}
    out = []
    for k, ls in sorted(group.items()):
        reached = lambda s: sum(1 for l in ls if l.stage != "closed_lost" and order[l.stage] >= order[s]) + (
            sum(1 for l in ls if l.stage == "closed_lost") if s in ("matched", "contacted") else 0)
        total = len(ls)
        row = {key: k, "total": total, "matched": total, "contacted": reached("contacted"), "replied": reached("replied"),
               "meeting": reached("meeting"), "won": sum(1 for l in ls if l.stage == "closed_won"),
               "lost": sum(1 for l in ls if l.stage == "closed_lost")}
        row["conversion"] = round(row["meeting"] / total, 3) if total else 0
        out.append(row)
    return out


def analytics() -> dict:
    leads = list(state.leads.values())
    by_stage = [{"stage": s, "count": sum(1 for l in leads if l.stage == s)} for s in STAGES]
    ind, tier, var = defaultdict(list), defaultdict(list), defaultdict(list)
    for l in leads:
        c = state.companies.get(l.company_id)
        ind[c.industry if c else "unknown"].append(l)
        tier[c.tier if c else "C"].append(l)
        var[l.variant].append(l)
    order = {s: i for i, s in enumerate(STAGES)}
    variants = []
    for v in ("A", "B"):
        ls = var.get(v, [])
        sent_touches = sum(1 for t in state.touches.values() if t.variant == v and t.status == "sent")
        contacted = sum(1 for l in ls if l.stage == "closed_lost" or order[l.stage] >= order["contacted"])
        replied = sum(1 for l in ls if l.stage != "closed_lost" and order[l.stage] >= order["replied"])
        meetings = sum(1 for l in ls if l.stage != "closed_lost" and order[l.stage] >= order["meeting"])
        variants.append({"variant": v, "leads": len(ls), "sent": sent_touches, "contacted": contacted, "replied": replied,
                         "meetings": meetings, "reply_rate": round(replied / contacted, 3) if contacted else 0})
    return {"byStage": by_stage, "byIndustry": _funnel(ind, "industry"), "byTier": _funnel(tier, "tier"), "variants": variants}
