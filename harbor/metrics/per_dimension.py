# /// script
# dependencies = []
# ///
"""Mean reward per dimension from Kindred's multi-key reward.json (harbor-cookbook multi-reward pattern)."""
import argparse
import json

ap = argparse.ArgumentParser()
ap.add_argument("-i", "--input-path", required=True)
ap.add_argument("-o", "--output-path", required=True)
a = ap.parse_args()
totals: dict[str, float] = {}
counts: dict[str, int] = {}
for line in open(a.input_path):
    r = json.loads(line) or {"reward": 0.0}
    for k, v in r.items():
        totals[k] = totals.get(k, 0.0) + float(v)
        counts[k] = counts.get(k, 0) + 1
json.dump({k: totals[k] / counts[k] for k in totals}, open(a.output_path, "w"))
