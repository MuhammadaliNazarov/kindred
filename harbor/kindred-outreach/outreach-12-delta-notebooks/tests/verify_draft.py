"""Grade /app/draft.txt against tests/task.json with the vendored Kindred verifier -> /logs/verifier/reward.json."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verifier import MAX_SCORE, verify  # noqa: E402

KEYS = ["company_mentioned", "cites_signal", "question_cta", "length_30_90", "claims_sourced", "no_guarantees", "allowed_links_only"]
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
