"""CLI: run the Warmpath Thompson-sampling bandit with SIMULATED replies (offline, no API needed).

    cd api && uv run python rl/bandit_sim.py --sends 300 --seed 0
Prints per-arm sent/replies/mean/share and the share history. Does not touch data/bandit.json.
"""
import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.bandit import SIM_TRUE_RATES, ThompsonPolicy  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sends", type=int, default=300)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    p = ThompsonPolicy()
    every = max(1, args.sends // 10)
    for i in range(1, args.sends + 1):
        arm = p.choose(rng)
        p.update(arm, int(rng.random() < SIM_TRUE_RATES[arm]))
        if i % every == 0:
            p.snapshot(i)
    out = p.summary(simulated=True)
    print(json.dumps({"simulated": True, "true_rates": SIM_TRUE_RATES, "sends": args.sends,
                      "arms": [{k: a[k] for k in ("id", "sent", "replies", "mean", "share")} for a in out["arms"]],
                      "history": out["history"]}, indent=2))


if __name__ == "__main__":
    main()
