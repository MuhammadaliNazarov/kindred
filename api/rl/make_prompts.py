"""Pull real discovered leads from a running Warmpath API and write rl/out/prompts.jsonl (one task per lead).

    cd api/rl && uv run python make_prompts.py --api http://localhost:8040
The train/eval split is fixed by company hash inside outreach_env.build_pool, so re-running never leaks eval into train.
"""
import argparse
import json
from pathlib import Path

import httpx

OUT = Path(__file__).resolve().parent / "out" / "prompts.jsonl"

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args()
    tasks = httpx.get(a.api.rstrip("/") + "/env/tasks", timeout=30).raise_for_status().json()
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    with open(a.out, "w") as f:
        for t in tasks:
            f.write(json.dumps(t) + "\n")
    print(f"wrote {len(tasks)} tasks -> {a.out}")
