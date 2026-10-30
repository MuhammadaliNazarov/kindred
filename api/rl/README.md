# Warmpath learning loop (RL)

Two pieces, both wired into the live app and runnable offline.

## 1. Reply-learning outreach (Thompson-sampling bandit) — live in the app
- `app/bandit.py`: arms = hook × CTA (`signal_hook__call`, `signal_hook__doc`, `warmpath_hook__call`, `warmpath_hook__doc`),
  each Beta(replies+1, no_replies+1), persisted to `data/bandit.json` (delete it to reset).
- Drafting (`outreach.draft`) picks the arm with `bandit.choose()` and stores it on each Touch (`arm`).
- Reward: lead moved to `replied`/`meeting`/`closed_won` or `POST /webhooks/reply {lead_id}` → 1;
  moved to `closed_lost` after a send without a reply → 0. Idempotent per lead.
- API: `GET /bandit`, `POST /bandit/simulate {sends, seed}` (SIMULATED replies on a copy, flagged `simulated:true`),
  `POST /bandit/reset` (drop the simulated overlay).
- Offline: `uv run python rl/bandit_sim.py --sends 300 --seed 0`.

## 2. Verifier-gated copy = the GRPO reward — not run today
- `app/verifier.py` scores a draft (max 4.5): company named, cited signal, question CTA, 30–90 words,
  every claim has a source; −2 outcome-guarantee words, −1 non-allowed links. The Reviewer verdict shows
  `verifier x/4.5` and the checklist; `POST /verify {text, company, signal}` exposes it.
- `rl/grpo_outreach.py` imports that same `score` as its reward.

Check the reward on a laptop:
```
cd api && uv run python rl/grpo_outreach.py --check
```

Train on a GPU (one T4 16GB is enough for Qwen2.5-0.5B + LoRA; trl 1.17.x):
```
pip install "trl>=1.17,<1.18" peft datasets accelerate
cd api && python rl/grpo_outreach.py --model Qwen/Qwen2.5-0.5B-Instruct --steps 200
```
Output LoRA lands in `grpo-out/final`.

On Tinker (Thinking Machines): use its GRPO/RL recipe with the same prompts (`make_prompt`) and pass
`app.verifier.score(text, company, signal, allowed_domains=["tenki.cloud"])` as the reward function;
no GPU needed locally.

## 3. CPU post-training loop (GRPO + DPO + held-out eval) — no GPU
- `rl/outreach_env.py`: OpenEnv/Gym-style `OutreachEnv.reset(seed)` / `.step(draft)`; reward = `app.verifier.score` normalised to [0,1].
  HTTP: `POST /env/reset {seed?}`, `POST /env/step {episode_id, draft}`, `GET /env/tasks`.
- Fixed group split by company hash (40% of companies held out → 30 eval prompts); training never sees eval companies.
- HITL → DPO: `GET /preferences/stats`, `GET /export/preferences` (JSONL: human_edit / human_reject / verifier pairs).
- `GET /model/eval` (rl/out/eval.json or `{status:"not_run"}`), `GET /model/train-log` (rl/out/train_log.json).

On a CPU box (venv with torch CPU + trl/peft/datasets/transformers, e.g. `~/rl/bin/python`, or `cd rl && uv sync`):
```
cd api/rl
~/rl/bin/python make_prompts.py --api http://localhost:8040          # optional: real leads
~/rl/bin/python train_grpo_cpu.py --steps 40                          # SmolLM2-360M-Instruct, LoRA, G=4, 120 tok
~/rl/bin/python eval.py --model HuggingFaceTB/SmolLM2-360M-Instruct --lora out/lora --n 30
curl -s localhost:8040/export/preferences -o out/preferences.jsonl && ~/rl/bin/python train_dpo_cpu.py --steps 30   # optional
```
