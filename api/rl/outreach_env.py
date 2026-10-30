"""OpenEnv-style (Gym API) single-step RL environment for Warmpath outreach.

    env = OutreachEnv(tasks)            # tasks = real discovered leads (via the API) or FALLBACK_TASKS
    obs = env.reset(seed=0)             # {company, buyer_role, signal, quote, allowed_links, instructions, ...}
    reward, done, info = env.step(draft)  # reward = verifier score normalised to [0, 1]; done=True; info={checks}

The reward is app.verifier.score: the SAME function the HITL Reviewer gate applies, so the gate and the RL reward
are literally one function. Stdlib-only (plus app.verifier) so it runs anywhere.
"""
from __future__ import annotations

import hashlib
import json
import random
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))
from app.verifier import MAX_SCORE, verify  # noqa: E402

MIN_SCORE = -3.5  # every check failed: length -0.5, guarantee -2, bad link -1
PRODUCT, PRODUCT_URL = "Tenki", "https://tenki.cloud"
PRODUCT_PITCH = "secure, fast-booting cloud sandboxes for AI agents, as an API"

# (company, domain, buyer_role, signal summary, source quote) — fictional; used when the API has no leads.
FALLBACK_TASKS = [
    ("Loopwright", "loopwright.example.com", "Head of Infrastructure", "Hiring a Senior Infrastructure Engineer to run agent code in secure sandboxes", "you will own the sandboxed execution layer that runs untrusted agent code"),
    ("Agentsmith Labs", "agentsmith.example.com", "CTO", "Raised an $18M Series A to scale autonomous coding agents", "agentsmith labs raised an 18 million series a to scale autonomous coding agents"),
    ("Tessellate AI", "tessellate.example.com", "Staff Platform Engineer", "Hiring an RL Environments Infrastructure Engineer", "spin up thousands of short lived environments for reinforcement learning rollouts"),
    ("Quillstack", "quillstack.example.com", "VP Engineering", "Launched an agent that runs customer code to answer support tickets", "our new agent runs your code to reproduce the bug before it answers"),
    ("Brightforge", "brightforge.example.com", "Head of Platform", "Migrating off self-hosted Firecracker for notebook isolation", "we are moving off our self hosted firecracker fleet for notebook isolation"),
    ("Pylon Agents", "pylon.example.com", "Founding Engineer", "Hiring a Founding Engineer for agent infrastructure", "you will design how our agents safely execute code and browse the web"),
    ("Fathom Data Co", "fathom.example.com", "CTO", "Appointed a new CTO from a developer-platform company", "fathom data co today announced its new chief technology officer"),
    ("Cinder Labs", "cinder.example.com", "VP Engineering", "Raised a $9M seed round to build browser agents", "cinder labs raised a nine million seed round to build browser agents"),
    ("Mosaic Eval", "mosaic.example.com", "Head of Research Engineering", "Launched a public benchmark that executes model-written code", "every submission runs model written code against hidden tests"),
    ("Runebook", "runebook.example.com", "CTO", "Hiring a Security Engineer to isolate customer workloads", "harden the isolation boundary between customer workloads"),
    ("Delta Notebooks", "deltanb.example.com", "Director of Platform", "Announced a migration from Docker to microVMs for notebook kernels", "we are migrating notebook kernels from docker to microvms"),
    ("Harbor Agents", "harbor.example.com", "Head of Infrastructure", "Raised a $25M Series B for enterprise coding agents", "harbor agents raised a 25 million series b for enterprise coding agents"),
    ("Lattice CI", "latticeci.example.com", "VP Engineering", "Posted about cold-start times slowing their agent test runners", "cold starts are slowing every agent test run we ship"),
    ("Nimbus Tutor", "nimbustutor.example.com", "CTO", "Launched a coding tutor that runs student code in the browser", "the tutor runs student code and explains each error"),
    ("Ferrous Labs", "ferrous.example.com", "Staff Engineer", "Hiring a Runtime Engineer for sandboxed Python execution", "build the sandboxed python runtime behind our agent"),
    ("Orbit Labs", "orbit.example.com", "Staff Engineer", "Announced a migration off self-hosted Firecracker VMs", "orbit labs is migrating off self hosted firecracker vms"),
    ("Kite Payments", "kite.example.com", "Head of Platform", "Launched an AI agent that executes customer scripts", "our agent now executes customer scripts on demand"),
    ("Sable Analytics", "sable.example.com", "Director of Engineering", "Hiring Platform Engineers to run untrusted SQL and Python", "run untrusted sql and python for thousands of analysts"),
    ("Verdant Robotics Cloud", "verdant.example.com", "VP Platform", "Raised a $14M Series A for simulation-as-a-service", "verdant raised a 14 million series a for simulation as a service"),
    ("Quanta Grader", "quanta.example.com", "CTO", "Launched automated grading that executes candidate code", "every candidate submission is executed and graded automatically"),
    ("Helix Agents", "helix.example.com", "Head of Infrastructure", "Hiring an SRE to scale agent sandboxes to 10k concurrent runs", "scale our agent sandboxes to ten thousand concurrent runs"),
    ("Arcade Dev", "arcade.example.com", "VP Engineering", "Posted that their sandbox provider doubled per-minute pricing", "our sandbox provider doubled per minute pricing this month"),
    ("Polaris Docs", "polaris.example.com", "Head of Platform", "Launched live code examples that run in the docs", "every code example in our docs now runs live"),
    ("Tidewater AI", "tidewater.example.com", "CTO", "Appointed a new VP of Infrastructure from a cloud provider", "tidewater ai named a new vice president of infrastructure"),
]

TEMPLATES = [
    "Write a cold email (30-90 words) to the {role} of {company}. Why now: {signal} (source quote: \"{quote}\"). "
    "We sell {product} ({product_url}): {pitch}. Name the company, mention the signal, end with ONE question as the call to action. "
    "Only link to {allowed}. No guarantees or promises.",
    "You are an SDR at {product}. Draft a short first-touch email to {company}'s {role}. Open with this signal: {signal}. "
    "Pitch: {pitch}. Rules: 30-90 words, name {company}, finish with a question, links only to {allowed}, never promise outcomes.",
    "Signal: {company} — {signal}. Evidence: \"{quote}\". Write a 30-90 word outbound email from {product} ({pitch}) to their {role}. "
    "Mention {company} and the signal, close with a single question. Allowed links: {allowed}. Do not guarantee results.",
]


def normalise(raw: float) -> float:
    return round(max(0.0, min(1.0, (raw - MIN_SCORE) / (MAX_SCORE - MIN_SCORE))), 4)


def task_from_tuple(t: tuple) -> dict:
    company, domain, role, signal, quote = t
    return {"company": company, "domain": domain, "buyer_role": role, "signal": signal, "quote": quote,
            "product": PRODUCT, "product_url": PRODUCT_URL, "allowed_domains": [d for d in ("tenki.cloud", domain) if d]}


def fallback_tasks() -> list[dict]:
    return [task_from_tuple(t) | {"source": "fallback"} for t in FALLBACK_TASKS]


def render(task: dict, template: int = 0) -> str:
    return TEMPLATES[template % len(TEMPLATES)].format(
        role=task["buyer_role"], company=task["company"], signal=task["signal"], quote=task.get("quote", ""),
        product=task.get("product", PRODUCT), product_url=task.get("product_url", PRODUCT_URL), pitch=PRODUCT_PITCH,
        allowed=", ".join(task.get("allowed_domains") or ["tenki.cloud"]))


def observation(task: dict, template: int = 0) -> dict:
    prompt = render(task, template)
    return {"company": task["company"], "person": task.get("person") or "", "title": task["buyer_role"],
            "buyer_role": task["buyer_role"], "signal": task["signal"], "source_url": task.get("source_url") or "",
            "source_quote": task.get("quote", ""), "quote": task.get("quote", ""),
            "allowed_links": task.get("allowed_domains", []), "prompt": prompt, "instructions": prompt, "template": template}


def score_draft(task: dict, draft: str) -> tuple[float, float, list[dict]]:
    """-> (reward in [0,1], raw verifier score, checks). Same function as the HITL Reviewer gate."""
    v = verify(draft, task["company"], task["signal"], context=task.get("quote", ""), allowed_domains=task.get("allowed_domains"))
    return normalise(v["score"]), v["score"], v["checks"]


def split_of(task: dict, eval_frac: float = 0.4, salt: str = "warmpath-v1") -> str:
    """Fixed, seed-free GROUP split by company (no company appears in both train and eval)."""
    h = int(hashlib.sha1(f"{salt}:{task['company'].lower()}".encode()).hexdigest(), 16) % 1000
    return "eval" if h < eval_frac * 1000 else "train"


def build_pool(tasks: list[dict]) -> list[dict]:
    """Each task x each instruction template -> one prompt row, tagged with its split."""
    seen, rows = set(), []
    for t in tasks:
        key = (t["company"].lower(), t["signal"].lower())
        if key in seen:
            continue
        seen.add(key)
        for k in range(len(TEMPLATES)):
            rows.append({**t, "template": k, "prompt_text": render(t, k), "split": split_of(t)})
    return rows


def load_rows(prompts_path: str | Path | None = None) -> list[dict]:
    """Rows from prompts.jsonl (written by make_prompts.py from the live API), plus the fallback seed so both splits are populated."""
    tasks: list[dict] = []
    p = Path(prompts_path) if prompts_path else API_DIR / "rl" / "out" / "prompts.jsonl"
    if p.exists():
        tasks = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
    return build_pool(tasks + fallback_tasks())


class OutreachEnv:
    """Gym-style: reset(seed) -> observation; step(draft) -> (reward, done, info). One step per episode."""

    def __init__(self, tasks: list[dict] | None = None, split: str | None = None):
        rows = build_pool(tasks or fallback_tasks())
        self.rows = [r for r in rows if split is None or r["split"] == split] or rows
        self.current: dict | None = None

    def reset(self, seed: int | None = None) -> dict:
        rng = random.Random(seed)
        self.current = rng.choice(self.rows)
        return observation(self.current, self.current["template"])

    def step(self, draft: str) -> tuple[float, bool, dict]:
        if self.current is None:
            raise RuntimeError("call reset() first")
        reward, raw, checks = score_draft(self.current, draft)
        return reward, True, {"checks": checks, "raw_score": raw, "max_score": MAX_SCORE}


if __name__ == "__main__":
    env = OutreachEnv()
    obs = env.reset(seed=1)
    print(json.dumps(obs, indent=1))
    good = (f"Hi there, saw {obs['company']}: {obs['signal']}. Teams in that spot often build sandbox infra themselves; "
            f"Tenki gives you that as an API so engineers stay on the product. Worth a 15-minute look next week?")
    print(env.step(good)[:2], env.step("We guarantee 100% results! http://spam.biz")[:2])
