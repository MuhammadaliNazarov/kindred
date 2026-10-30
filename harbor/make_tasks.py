"""Generate Kindred's outreach task as a Harbor dataset: harbor/kindred-outreach/<task-id>/ (20 tasks).

    python3 harbor/make_tasks.py                       # live API -> api/rl/out/prompts.jsonl -> built-in fallback leads
    python3 harbor/make_tasks.py --api http://localhost:8040 --n 20

Each task (Harbor schema 1.4, verifier in shared mode):
  instruction.md          the lead, buyer role, cited signal + quote + source URL, allowed links, rules; write /app/draft.txt
  task.toml               timeouts / resources / no network for the verifier
  environment/Dockerfile  python:3.12-slim, WORKDIR /app
  tests/test.sh           runs tests/verify_draft.py -> /logs/verifier/reward.json (one key per check + `reward` in [0,1])
  tests/verifier.py       standalone copy of api/app/verifier.py (stdlib only; no repo dependency)
  tests/task.json         the lead the verifier grades against
  solution/solve.sh       oracle: a known-good draft (checked here to score reward == 1.0 before it is written)
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "kindred-outreach"
API = "https://warmpath-api--u6faat.us.sb.tenki.sh"
PROMPTS = ROOT / "api" / "rl" / "out" / "prompts.jsonl"
VERIFIER_SRC = ROOT / "api" / "app" / "verifier.py"

sys.path.insert(0, str(ROOT / "api" / "rl"))
from outreach_env import PRODUCT_PITCH, fallback_tasks, normalise  # noqa: E402

sys.path.insert(0, str(ROOT / "api"))
from app.verifier import verify  # noqa: E402

# Stable reward keys, in verifier check order.
CHECK_KEYS = ["company_mentioned", "cites_signal", "question_cta", "length_30_90",
              "claims_sourced", "no_guarantees", "allowed_links_only"]

VERIFY_DRAFT = '''"""Grade /app/draft.txt against tests/task.json with the vendored Kindred verifier -> /logs/verifier/reward.json."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verifier import MAX_SCORE, verify  # noqa: E402

KEYS = %(keys)s
MIN_SCORE = -3.5  # every check failed (length -0.5, guarantee -2, bad link -1)

task = json.loads((Path(__file__).resolve().parent / "task.json").read_text())
draft_path = Path("/app/draft.txt")
out = Path("/logs/verifier")
out.mkdir(parents=True, exist_ok=True)

draft = draft_path.read_text() if draft_path.exists() else ""
if not draft.strip():
    rewards = {k: 0.0 for k in KEYS} | {"reward": 0.0}
    detail = {"error": "no draft at /app/draft.txt"}
else:
    v = verify(draft, task["company"], task["signal"], context=task.get("quote", ""),
               allowed_domains=task.get("allowed_domains"))
    rewards = {k: float(bool(c["pass"])) for k, c in zip(KEYS, v["checks"])}
    rewards["reward"] = round(max(0.0, min(1.0, (v["score"] - MIN_SCORE) / (MAX_SCORE - MIN_SCORE))), 4)
    detail = v
(out / "reward.json").write_text(json.dumps(rewards))
(out / "verifier_detail.json").write_text(json.dumps(detail, indent=1))
print(json.dumps(rewards))
'''

TEST_SH = """#!/bin/bash
# Multi-reward verifier (harbor-cookbook multi-reward style): one key per check + `reward` (normalised total).
mkdir -p /logs/verifier
python3 /tests/verify_draft.py || echo '{"reward": 0.0}' > /logs/verifier/reward.json
"""

DOCKERFILE = """FROM python:3.12-slim

WORKDIR /app
"""

TASK_TOML = """schema_version = "1.4"
artifacts = ["/app/draft.txt"]

[task]
name = "kindred/{slug}"
version = "1.0.0"
description = "Write a verifier-gated cold email to {company} ({role}) grounded in a cited buying signal."
authors = []
keywords = ["kindred", "gtm", "outreach", "rlvr", "multi-reward"]

[metadata]
source = "{source}"
lead_id = "{lead_id}"

[verifier]
timeout_sec = 60.0
environment_mode = "shared"

[agent]
timeout_sec = 300.0

[environment]
build_timeout_sec = 600.0
cpus = 1
memory_mb = 1024
storage_mb = 2048
"""

INSTRUCTION = """# Write a cold email for {company}

You are an SDR at **{product}** ({product_url}): {pitch}.

## The lead
- **Company:** {company} ({domain})
- **Recipient:** {person_line}
- **Buyer role:** {role}

## Why now (the cited signal)
- **Signal:** {signal}
- **Source quote:** "{quote}"
- **Source URL:** {source_url}

## Allowed links
{allowed_list}

## Rules
1. 30 to 90 words.
2. Name **{company}** and reference the signal above.
3. Every factual claim must come from the signal or the quote. Do not invent numbers, funding, customers or news.
4. End with exactly one question as the call to action (a sign-off line after it is fine).
5. Link only to the allowed domains above (no link is fine).
6. No outcome guarantees or promises ("guarantee", "100%", "risk-free", "never fail").

## Output
Write the email body (plain text, no subject line) to `/app/draft.txt`.
"""


def fetch_live(api: str) -> list[dict]:
    url = api.rstrip("/") + "/env/tasks"
    try:
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                data = json.load(r)
        except urllib.error.URLError:  # macOS python without a CA bundle: use curl's system trust store
            data = json.loads(subprocess.run(["curl", "-fsS", "-m", "20", url], check=True,
                                             capture_output=True, text=True).stdout)
        return [t | {"source": t.get("source") or "lead"} for t in data]
    except Exception as e:  # noqa: BLE001
        print(f"live API unavailable ({e}); falling back", file=sys.stderr)
        return []


def load_leads(api: str, n: int) -> list[dict]:
    pool = fetch_live(api)
    if PROMPTS.exists():
        pool += [json.loads(l) | {"source": "prompts.jsonl"} for l in PROMPTS.read_text().splitlines() if l.strip()]
    pool += fallback_tasks()
    seen, leads = set(), []
    for t in pool:
        k = t["company"].lower()
        if k not in seen:
            seen.add(k)
            leads.append(t)
    return leads[:n]


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def oracle_draft(t: dict) -> str:
    first = (t.get("person") or "").split(" ")[0] or "there"
    sig = t["signal"].rstrip(".")
    sig = sig[0].lower() + sig[1:]
    return (f"Hi {first},\n\n"
            f"Saw that {t['company']} is {sig}.\n"
            f"Tenki gives your team secure, fast-booting cloud sandboxes for AI agents as an API, "
            f"so engineers stay focused on the product instead of isolation plumbing.\n"
            f"Would a 15-minute look next week be useful?\n\n"
            f"— Ali")


def write_task(i: int, t: dict) -> tuple[str, float]:
    t = {**t, "allowed_domains": t.get("allowed_domains") or [d for d in ("tenki.cloud", t.get("domain")) if d]}
    slug = f"outreach-{i:02d}-{slugify(t['company'])}"
    d = OUT / slug
    if d.exists():
        shutil.rmtree(d)
    (d / "environment").mkdir(parents=True)
    (d / "tests").mkdir()
    (d / "solution").mkdir()

    draft = oracle_draft(t)
    v = verify(draft, t["company"], t["signal"], context=t.get("quote", ""), allowed_domains=t["allowed_domains"])
    reward = normalise(v["score"])
    if reward < 1.0:
        raise SystemExit(f"oracle draft for {t['company']} scores {reward}: {v['checks']}")

    task_json = {k: t.get(k) for k in ("company", "domain", "buyer_role", "person", "signal", "quote", "source_url",
                                       "lead_id", "product", "product_url", "allowed_domains", "source")}
    (d / "instruction.md").write_text(INSTRUCTION.format(
        company=t["company"], domain=t.get("domain") or "n/a", product=t.get("product") or "Tenki",
        product_url=t.get("product_url") or "https://tenki.cloud", pitch=PRODUCT_PITCH,
        person_line=t.get("person") or "(name unknown; address the role)", role=t["buyer_role"],
        signal=t["signal"], quote=t.get("quote", ""), source_url=t.get("source_url") or "(not provided)",
        allowed_list="\n".join(f"- {x}" for x in t["allowed_domains"])))
    (d / "task.toml").write_text(TASK_TOML.format(slug=slug, company=t["company"].replace('"', ""),
                                                 role=t["buyer_role"], source=t.get("source", ""),
                                                 lead_id=t.get("lead_id") or ""))
    (d / "environment" / "Dockerfile").write_text(DOCKERFILE)
    (d / "tests" / "test.sh").write_text(TEST_SH)
    (d / "tests" / "verifier.py").write_text(VERIFIER_SRC.read_text())
    (d / "tests" / "verify_draft.py").write_text(VERIFY_DRAFT % {"keys": json.dumps(CHECK_KEYS)})
    (d / "tests" / "task.json").write_text(json.dumps(task_json, indent=1))
    (d / "solution" / "solve.sh").write_text(f"#!/bin/bash\ncat > /app/draft.txt << 'EOF'\n{draft}\nEOF\n")
    for f in (d / "tests" / "test.sh", d / "solution" / "solve.sh"):
        f.chmod(0o755)
    return slug, reward


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=API)
    ap.add_argument("--n", type=int, default=20)
    a = ap.parse_args()
    leads = load_leads(a.api, a.n)
    OUT.mkdir(parents=True, exist_ok=True)
    for i, t in enumerate(leads, 1):
        slug, r = write_task(i, t)
        print(f"{slug:48s} source={t.get('source')} oracle_reward={r}")
    print(f"wrote {len(leads)} tasks -> {OUT}")
