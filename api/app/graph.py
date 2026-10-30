"""Kùzu embedded knowledge graph (DESIGN §5). Rebuilt from in-memory state on boot."""
from __future__ import annotations

import os
import shutil
import threading
from pathlib import Path

import kuzu

from . import billing, thinking
from .models import GraphData, GraphLink, GraphNode, Hop

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "graph.kuzu"
ME = "me"
PRODUCT = "product"
_lock = threading.RLock()
_db = None
_conn = None

SCHEMA = [
    "CREATE NODE TABLE IF NOT EXISTS Company(id STRING, name STRING, domain STRING, industry STRING, score INT64, tier STRING, PRIMARY KEY(id))",
    "CREATE NODE TABLE IF NOT EXISTS Person(id STRING, name STRING, title STRING, kind STRING, PRIMARY KEY(id))",
    "CREATE NODE TABLE IF NOT EXISTS Product(id STRING, name STRING, url STRING, PRIMARY KEY(id))",
    "CREATE NODE TABLE IF NOT EXISTS Competitor(id STRING, name STRING, PRIMARY KEY(id))",
    "CREATE NODE TABLE IF NOT EXISTS Signal(id STRING, type STRING, summary STRING, date STRING, PRIMARY KEY(id))",
    "CREATE NODE TABLE IF NOT EXISTS Source(url STRING, title STRING, quote STRING, verified BOOLEAN, PRIMARY KEY(url))",
    "CREATE REL TABLE IF NOT EXISTS works_at(FROM Person TO Company)",
    "CREATE REL TABLE IF NOT EXISTS previously_employed_at(FROM Person TO Company)",
    "CREATE REL TABLE IF NOT EXISTS competes_with(FROM Competitor TO Product)",
    "CREATE REL TABLE IF NOT EXISTS matched_to(FROM Company TO Product, score INT64)",
    "CREATE REL TABLE IF NOT EXISTS contacted_via(FROM Person TO Product, channel STRING, touch_id STRING)",
    "CREATE REL TABLE IF NOT EXISTS replied_to(FROM Person TO Product)",
    "CREATE REL TABLE IF NOT EXISTS has_signal(FROM Company TO Signal)",
    "CREATE REL TABLE IF NOT EXISTS cited_by(FROM Source TO Signal)",
    "CREATE REL TABLE IF NOT EXISTS uses(FROM Company TO Competitor)",
]


def init(fresh: bool = True) -> None:
    global _db, _conn
    with _lock:
        _conn = None
        _db = None
        if fresh and DB_PATH.exists():
            shutil.rmtree(DB_PATH) if DB_PATH.is_dir() else os.remove(DB_PATH)
            wal = Path(str(DB_PATH) + ".wal")
            if wal.exists():
                os.remove(wal)
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _db = kuzu.Database(str(DB_PATH))
        _conn = kuzu.Connection(_db)
        for s in SCHEMA:
            _conn.execute(s)


def _run(cypher: str, params: dict | None = None) -> list[list]:
    with _lock:
        r = _conn.execute(cypher, params or {})
        rows = []
        while r.has_next():
            rows.append(r.get_next())
        return rows


def query(cypher: str, params: dict | None = None, why: str = "", agent: str = "graph") -> list[list]:
    """A user-visible read query: emits a ThinkingStep with the Cypher and meters graph_query."""
    thinking.emit(agent, "graph", why or "Graph query", cypher=cypher.strip())
    billing.meter("graph_query", quiet=True)
    return _run(cypher, params)


# ---------- upserts (internal writes, not metered) ----------
def upsert_product(name: str, url: str) -> None:
    _run("MERGE (p:Product {id:$id}) SET p.name=$n, p.url=$u", {"id": PRODUCT, "n": name, "u": url})


def upsert_me(name: str = "You") -> None:
    _run("MERGE (p:Person {id:$id}) SET p.name=$n, p.title='Founder', p.kind='me'", {"id": ME, "n": name})


def upsert_company(c) -> None:
    _run(
        "MERGE (x:Company {id:$id}) SET x.name=$n, x.domain=$d, x.industry=$i, x.score=$s, x.tier=$t",
        {"id": c.id, "n": c.name, "d": c.domain or "", "i": c.industry, "s": int(c.score), "t": c.tier},
    )
    _run(
        "MATCH (x:Company {id:$id}), (p:Product {id:$p}) MERGE (x)-[r:matched_to]->(p) SET r.score=$s",
        {"id": c.id, "p": PRODUCT, "s": int(c.score)},
    )
    for comp in c.competitors_used:
        upsert_competitor(comp)
        _run("MATCH (x:Company {id:$id}), (k:Competitor {id:$k}) MERGE (x)-[:uses]->(k)", {"id": c.id, "k": _cid(comp)})
    for s in c.signals:
        upsert_signal(s)


def delete_company(cid: str) -> None:
    """Remove a company, its signals and the prospects that work there (used to drop seed accounts once real ones exist)."""
    _run("MATCH (c:Company {id:$id})-[:has_signal]->(g:Signal) DETACH DELETE g", {"id": cid})
    _run("MATCH (p:Person)-[:works_at]->(c:Company {id:$id}) WHERE p.kind = 'prospect' DETACH DELETE p", {"id": cid})
    _run("MATCH (c:Company {id:$id}) DETACH DELETE c", {"id": cid})


def ensure_company_stub(cid: str, name: str) -> None:
    _run("MERGE (x:Company {id:$id}) ON CREATE SET x.name=$n, x.domain='', x.industry='', x.score=0, x.tier=''", {"id": cid, "n": name})


def _cid(name: str) -> str:
    return "comp:" + name.lower().replace(" ", "-")


def upsert_competitor(name: str) -> None:
    _run("MERGE (k:Competitor {id:$id}) SET k.name=$n", {"id": _cid(name), "n": name})
    _run("MATCH (k:Competitor {id:$id}), (p:Product {id:$p}) MERGE (k)-[:competes_with]->(p)", {"id": _cid(name), "p": PRODUCT})


def upsert_signal(s) -> None:
    _run("MERGE (g:Signal {id:$id}) SET g.type=$t, g.summary=$s, g.date=$d", {"id": s.id, "t": s.type, "s": s.summary, "d": s.date})
    _run("MATCH (c:Company {id:$c}), (g:Signal {id:$id}) MERGE (c)-[:has_signal]->(g)", {"c": s.company_id, "id": s.id})
    src = s.source
    _run(
        "MERGE (x:Source {url:$u}) SET x.title=$t, x.quote=$q, x.verified=$v",
        {"u": src.url, "t": src.title, "q": src.quote, "v": bool(src.verified)},
    )
    _run("MATCH (x:Source {url:$u}), (g:Signal {id:$id}) MERGE (x)-[:cited_by]->(g)", {"u": src.url, "id": s.id})


def upsert_person(pid: str, name: str, title: str, company_id: str | None, kind: str = "prospect") -> None:
    _run("MERGE (p:Person {id:$id}) SET p.name=$n, p.title=$t, p.kind=$k", {"id": pid, "n": name, "t": title, "k": kind})
    if company_id:
        _run("MATCH (p:Person {id:$id}), (c:Company {id:$c}) MERGE (p)-[:works_at]->(c)", {"id": pid, "c": company_id})


def add_previous_employer(pid: str, company_id: str, company_name: str | None = None) -> None:
    ensure_company_stub(company_id, company_name or company_id)
    _run("MATCH (p:Person {id:$id}), (c:Company {id:$c}) MERGE (p)-[:previously_employed_at]->(c)", {"id": pid, "c": company_id})


def add_contacted(person_id: str, channel: str, touch_id: str) -> None:
    _run(
        "MATCH (p:Person {id:$id}), (x:Product {id:$p}) MERGE (p)-[r:contacted_via {touch_id:$t}]->(x) SET r.channel=$ch",
        {"id": person_id, "p": PRODUCT, "t": touch_id, "ch": channel},
    )


def add_replied(person_id: str) -> None:
    _run("MATCH (p:Person {id:$id}), (x:Product {id:$p}) MERGE (p)-[:replied_to]->(x)", {"id": person_id, "p": PRODUCT})


# ---------- demo queries ----------
WARM_PATH_CYPHER = """MATCH (me:Person {id: $me})-[e:works_at|previously_employed_at* SHORTEST 1..4]-(buyer:Person {id: $buyer})
RETURN me, nodes(e), rels(e), buyer"""


def _key(i: dict) -> tuple:
    return (i["table"], i["offset"])


def warm_path(me_id: str, person_id: str) -> tuple[list[Hop], str]:
    rows = query(WARM_PATH_CYPHER, {"me": me_id, "buyer": person_id}, why=f"Warm path: shared past employers within 4 hops of {person_id}", agent="planner")
    if not rows:
        thinking.emit("planner", "reason", f"No warm path to {person_id}; outreach will lead with the signal only")
        return [], WARM_PATH_CYPHER
    me, mid, rels, buyer = rows[0]
    names = {_key(n["_id"]): (n.get("name") or n.get("id")) for n in [me, *mid, buyer]}
    hops = [Hop(**{"from": names.get(_key(r["_src"]), "?"), "rel": r["_label"], "to": names.get(_key(r["_dst"]), "?")}) for r in rels]
    seq = [me.get("name")] + [n.get("name") for n in mid] + [buyer.get("name")]
    thinking.emit("planner", "graph", "Warm path: " + " → ".join(seq))
    return hops, WARM_PATH_CYPHER


HIRING_CYPHER = """MATCH (c:Company)-[:has_signal]->(s:Signal {type: 'job_post'})
WHERE s.date >= $since
OPTIONAL MATCH (c)-[:uses]->(k:Competitor)
RETURN c.id, c.name, s.summary, s.date, collect(k.name)
ORDER BY s.date DESC"""


def hiring_signals(since: str) -> list[dict]:
    rows = query(HIRING_CYPHER, {"since": since}, why="Hiring → evaluation: job posts in the last 30 days", agent="discovery")
    return [{"company_id": r[0], "company": r[1], "summary": r[2], "date": r[3], "competitors": [x for x in (r[4] or []) if x]} for r in rows]


# ---------- graph pane ----------
def subgraph(lead_person_id: str | None, lead_company_id: str | None) -> GraphData:
    nodes: dict[str, GraphNode] = {}
    links: list[GraphLink] = []

    def node(n: dict) -> str:
        label = n["_label"]
        nid = n.get("id") or n.get("url")
        typ = "Me" if (label == "Person" and nid == ME) else label
        if typ == "Source":
            return nid
        nodes.setdefault(nid, GraphNode(id=nid, label=n.get("name") or n.get("summary") or nid, type=typ))
        return nid

    def add_rows(rows):
        for a, r, b in rows:
            if a["_label"] == "Source" or b["_label"] == "Source":
                continue
            links.append(GraphLink(source=node(a), target=node(b), rel=r["_label"]))

    if lead_company_id:
        cy = "MATCH (c:Company {id:$c})-[r]-(x) RETURN c, r, x"
        add_rows(query(cy, {"c": lead_company_id}, why=f"Neighbourhood of {lead_company_id}"))
        if lead_person_id:
            hops, _ = warm_path(ME, lead_person_id)
            names = {h.from_ for h in hops} | {h.to for h in hops}
            if names:
                rows = _run(
                    "MATCH (a)-[r:works_at|previously_employed_at]-(b) WHERE a.name IN $n AND b.name IN $n RETURN a, r, b",
                    {"n": list(names)},
                )
                add_rows(rows)
    else:
        add_rows(query("MATCH (a)-[r]->(b) RETURN a, r, b LIMIT 400", why="Full knowledge graph"))
    seen, uniq = set(), []
    for l in links:
        k = (l.source, l.target, l.rel)
        if k not in seen:
            seen.add(k)
            uniq.append(l)
    return GraphData(nodes=list(nodes.values()), links=uniq)
