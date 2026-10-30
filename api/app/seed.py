"""Demo dataset (fictional companies, example.com URLs, verified:false) so every GET returns data on first boot."""
from __future__ import annotations

import re

from . import graph, icp as icp_mod, pipeline, state, thinking
from .models import ICP, Company, ExpansionSegment, Intake, Person, Signal, Source, Touch, Review, Security

DEFAULT_EMPLOYERS = ["Northwind Payments", "Copperline Cloud"]

INTAKE = Intake(
    product_name="Tenki",
    product_url="https://tenki.cloud",
    description="Cloud sandboxes for AI agents: spin up isolated, fast-booting environments to run agent-generated code, with preview URLs.",
    features=["Isolated microVM sandboxes", "Sub-second cold start", "Preview URLs", "Python/TS SDK"],
    constraints=["Public data only", "No sends to real prospects in demo"],
    reference_customers=["AI coding-agent startups"],
    pricing_model="Usage-based (sandbox-minutes) + team plan",
    acv_usd=24000,
    lost_deal="Lost a Series A agent startup that built on raw Firecracker in-house",
    past_employers=[],
)


def _src(slug: str, title: str, quote: str) -> Source:
    return Source(url=f"https://example.com/{slug}", title=title, quote=quote, fetched_at="2026-10-30T09:00:00+00:00", verified=False)


# (id, name, domain, industry, naics, headcount, hq, competitors, signals[(type, summary, date, slug, quote)], people[(name,title,seniority)], connector?)
COMPANIES = [
    ("co_loopwright", "Loopwright", "loopwright.example.com", "AI agent platforms", "513210", 42, "San Francisco, CA", ["E2B"],
     [("job_post", "Hiring a Senior Infrastructure Engineer to run agent code in secure sandboxes", "2026-10-24", "loopwright/jobs/senior-infra",
       "you will own the sandboxed execution layer that runs untrusted agent code")],
     [("Priya Raman", "Head of Infrastructure", "Director")], ("Daniel Okafor", 0)),
    ("co_agentsmith", "Agentsmith Labs", "agentsmith.example.com", "AI agent platforms", "513210", 65, "New York, NY", ["Modal"],
     [("funding", "Raised an $18M Series A to scale autonomous coding agents", "2026-10-15", "agentsmith/news/series-a",
       "agentsmith labs raised an 18 million series a to scale autonomous coding agents"),
      ("job_post", "Hiring Platform Engineers for agent runtime", "2026-10-21", "agentsmith/jobs/platform",
       "build the runtime where thousands of agents execute code every hour")],
     [("Marco Bellini", "CTO", "C-level")], ("Grace Liu", 1)),
    ("co_tessellate", "Tessellate AI", "tessellate.example.com", "AI research & eval labs", "541715", 28, "London, UK", [],
     [("job_post", "Hiring an RL Environments Infrastructure Engineer", "2026-10-27", "tessellate/jobs/rl-infra",
       "spin up thousands of short lived environments for reinforcement learning rollouts")],
     [("Hana Sato", "Staff Platform Engineer", "IC")], None),
    ("co_quillstack", "Quillstack", "quillstack.example.com", "Developer tools & coding assistants", "541511", 90, "Austin, TX", ["Daytona"],
     [("launch", "Launched an agent that runs customer code to answer support tickets", "2026-10-20", "quillstack/blog/agent-launch",
       "our new agent runs your code to reproduce the bug before it answers"),
      ("churn_risk", "Public complaints about sandbox cold-start times on their current provider", "2026-10-26", "quillstack/forum/cold-starts",
       "cold starts on our sandbox provider are adding seconds to every agent run")],
     [("Leo Fischer", "VP Engineering", "Director")], ("Daniel Okafor", None)),
    ("co_brightforge", "Brightforge", "brightforge.example.com", "Data notebook platforms", "513210", 140, "Berlin, DE", [],
     [("tech_change", "Migrating off self-hosted Firecracker for notebook isolation", "2026-10-09", "brightforge/eng/firecracker",
       "we are moving off our self hosted firecracker fleet for notebook isolation")],
     [("Amara Nwosu", "Head of Platform", "Director")], None),
    ("co_pylon", "Pylon Agents", "pylon.example.com", "AI agent platforms", "513210", 18, "Toronto, CA", ["E2B"],
     [("job_post", "Founding Engineer, agent infrastructure", "2026-10-28", "pylon/jobs/founding-eng",
       "you will design how our agents safely execute code and browse the web"),
      ("churn_risk", "Competitor pricing change announced for sandbox minutes", "2026-10-18", "pylon/notes/pricing",
       "the new per minute sandbox pricing doubles our monthly bill")],
     [("Ivan Petrov", "Founding Engineer", "IC")], ("Grace Liu", None)),
    ("co_fathom", "Fathom Data Co", "fathom.example.com", "Developer tools & coding assistants", "541511", 210, "Seattle, WA", [],
     [("exec_hire", "Appointed a new CTO from a developer-platform company", "2026-09-30", "fathom/news/new-cto",
       "fathom data co today announced its new chief technology officer")],
     [("Sofia Marin", "CTO", "C-level")], None),
    ("co_kestrel", "Kestrel Robotics", "kestrel.example.com", "Robotics hardware", "333999", 620, "Pittsburgh, PA", [],
     [("launch", "Launched a new warehouse robot arm", "2026-08-30", "kestrel/news/arm", "kestrel robotics launches its new warehouse robot arm")],
     [("Tom Reyes", "Director of Software", "Director")], None),
]

# planted failing claim: the quote does not appear at the URL -> dropped by the validator
FAILING_CLAIM = {"claim": "Loopwright signed a $2M contract with E2B", "company": "Loopwright",
                 **_src("loopwright/press/e2b-contract", "Loopwright press (demo)", "loopwright signed a two million dollar multi year contract with e2b").model_dump()}

CONNECTORS: dict[str, dict] = {}  # name -> {"id", "employer_idx", "target"}
SEED_IDS: set[str] = {c[0] for c in COMPANIES}


def is_seed(company_id: str) -> bool:
    return company_id in SEED_IDS


def purge() -> int:
    """Drop the fictional demo accounts (buyers, leads, drafts, graph nodes) once discovery has verified real ones.
    Idempotent; the seeds only stay when discovery found nothing."""
    from . import outreach

    with state.lock:
        cids = [cid for cid in SEED_IDS if cid in state.companies]
        if not cids:
            return 0
        pids = {p.id for p in state.people.values() if p.company_id in SEED_IDS}
        lids = {l.id for l in state.leads.values() if l.company_id in SEED_IDS}
        tids = {t.id for t in state.touches.values() if t.lead_id in lids}
        for d, keys in ((state.companies, cids), (state.people, pids), (state.leads, lids), (state.touches, tids), (outreach.state_warm, lids)):
            for k in keys:
                d.pop(k, None)
        state.dropped_claims[:] = [d for d in state.dropped_claims if "example.com" not in (d.get("url") or "")]
        for cid in cids:
            graph.delete_company(cid)
    thinking.emit("discovery", "reason", f"Real verified accounts found — removed {len(cids)} seeded demo accounts ({len(lids)} demo leads) from the pipeline and graph")
    state.log("ai", "seed_purged", f"{len(cids)} demo accounts removed; {len(state.companies)} real accounts remain", agent="discovery")
    return len(cids)


def set_me_history(employers: list[str]) -> list[str]:
    """(Me)-[:previously_employed_at]->(Company) from the founder's real history; seeded connectors are re-pointed so warm paths use it."""
    employers = [e.strip() for e in employers if e.strip()] or DEFAULT_EMPLOYERS
    graph._run("MATCH (p:Person)-[r:previously_employed_at]->() WHERE p.id = $me OR p.kind = 'connector' DELETE r", {"me": graph.ME})
    ids = []
    for e in employers:
        cid = "past:" + re.sub(r"[^a-z0-9]+", "-", e.lower()).strip("-")
        graph.add_previous_employer(graph.ME, cid, e)
        ids.append((cid, e))
    for name, c in CONNECTORS.items():
        cid, e = ids[c["employer_idx"] % len(ids)]
        graph.add_previous_employer(c["id"], cid, e)
    thinking.emit("graph", "graph", f"Me → previously_employed_at → {', '.join(employers)}",
                  cypher="MATCH (me:Person {id:'me'}), (c:Company {id:$cid}) MERGE (me)-[:previously_employed_at]->(c)")
    return employers


def replay_validation() -> None:
    for c in state.companies.values():
        for s in c.signals:
            thinking.emit("discovery", "validate", f"Seed source {s.source.url} — demo data, kept as verified:false")
    thinking.emit("discovery", "validate", f"Dropped: quote not found at {FAILING_CLAIM['url']}")
    if not any(d["url"] == FAILING_CLAIM["url"] for d in state.dropped_claims):
        state.dropped_claims.append(dict(FAILING_CLAIM))


def load() -> None:
    graph.init(fresh=True)
    graph.upsert_product(INTAKE.product_name, INTAKE.product_url)
    graph.upsert_me("You (founder)")
    data = icp_mod.fallback_icp(INTAKE)
    state.intake, state.icp = INTAKE, ICP.model_validate(data["icp"])
    state.expansions = {f"seg{i}": ExpansionSegment(id=f"seg{i}", name=e["name"], rationale=e["rationale"], confidence=e["confidence"],
                                                    sources=[_src(f"evidence/segment-{i}", f"{e['name']} (demo evidence)", e["rationale"][:90])], status="suggested")
                        for i, e in enumerate(data["expansions"], 1)}
    ci = 0
    for cid, name, dom, ind, naics, hc, hq, comps, sigs, ppl, conn in COMPANIES:
        signals = []
        for j, (t, summ, d, slug, q) in enumerate(sigs):
            signals.append(Signal(id=f"sig_{cid[3:]}_{j}", company_id=cid, type=t, summary=summ, date=d, source=_src(slug, f"{name} — {summ[:50]} (demo)", q)))
        co = Company(id=cid, name=name, domain=dom, industry=ind, naics=naics, headcount=hc, hq=hq, fit=0, intent=0, score=0, tier="C",
                     signals=signals, competitors_used=comps, sources=[_src(f"{cid[3:]}/about", f"{name} — about (demo)", f"{name.lower()} builds {ind.lower()}")])
        state.companies[cid] = co
        graph.upsert_company(co)
        for pname, title, sen in ppl:
            pid = "p_" + pname.split()[0].lower()
            state.people[pid] = Person(id=pid, company_id=cid, name=pname, title=title, seniority=sen, sources=[co.sources[0]])
            graph.upsert_person(pid, pname, title, cid)
        if conn:
            cname, idx = conn
            if cname not in CONNECTORS:
                CONNECTORS[cname] = {"id": "c_" + cname.split()[0].lower(), "employer_idx": idx if idx is not None else ci}
                ci += 1
            graph.upsert_person(CONNECTORS[cname]["id"], cname, "Engineer", cid, kind="connector")
    set_me_history(INTAKE.past_employers)
    from . import discovery
    discovery.rescore_all()
    # leads with a spread of stages for the Kanban/analytics
    stages = {"p_priya": ("matched", "ai"), "p_marco": ("contacted", "ai"), "p_hana": ("matched", "ai"), "p_leo": ("replied", "rep"),
              "p_amara": ("meeting", "rep"), "p_ivan": ("contacted", "ai"), "p_sofia": ("closed_lost", "rep"), "p_tom": ("matched", "ai")}
    for pid, p in state.people.items():
        st, owner = stages.get(pid, ("matched", "ai"))
        lead = pipeline.create_lead(pid, p.company_id, st, owner)
        state.log("ai", "lead_created", f"{p.name} @ {state.companies[p.company_id].name} matched (score {state.companies[p.company_id].score})", agent="discovery", lead_id=lead.id)
        if st != "matched":
            state.log(owner, "stage_move", f"matched → {st}", agent="builder" if owner == "ai" else None, lead_id=lead.id)
    # one pre-drafted sequence for the first lead so the HITL queue isn't empty
    from . import outreach
    first = next(l for l in state.leads.values() if l.person_id == "p_priya")
    outreach.draft(first.id, use_llm=False)
    replay_validation()
    thinking.emit("planner", "reason", f"Seed loaded: {len(state.companies)} accounts, {len(state.people)} buyers, {len(state.leads)} leads (demo data, verified:false)")
