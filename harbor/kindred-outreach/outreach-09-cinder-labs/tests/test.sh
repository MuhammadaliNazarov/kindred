#!/bin/bash
# Multi-reward verifier (harbor-cookbook multi-reward style): one key per check + `reward` (normalised total).
mkdir -p /logs/verifier
python3 /tests/verify_draft.py || echo '{"reward": 0.0}' > /logs/verifier/reward.json
