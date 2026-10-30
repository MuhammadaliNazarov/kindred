#!/usr/bin/env bash
# Start all four WarmPath Band agents (Planner, Builder, Reviewer, Security) in one process.
# Usage: ./run_all.sh            (live, needs .env with Band + Anthropic keys)
#        ./run_all.sh --dry-run  (local simulation, no keys)
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { [ "${1:-}" = "--dry-run" ] || { echo "No .env — copy .env.example and fill in the keys"; exit 1; }; }
exec uv run python agents.py "${@:-all}"
