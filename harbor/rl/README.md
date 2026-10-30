# harbor-rl on Kindred outreach (Tinker + LoRA)

Adapted from [harbor-cookbook `harbor_rl`](https://github.com/harbor-framework/harbor-cookbook/tree/main/harbor_cookbook/harbor_rl):
`harbor.rl.RLEnvironment` turns each `harbor/kindred-outreach/<task>` into an env with a bash tool + `grade()`;
Tinker does sampling, gradients and LoRA weight updates. Reward = `grade().rewards["reward"]` (the Kindred
verifier, normalised to [0,1]); the per-check keys are logged as metrics.

## Requirements
- `TINKER_API_KEY` exported, **with Tinker billing active** (otherwise sampling/training calls are refused).
- A sandbox backend for the task containers: local **Docker** (with the `docker compose` plugin) or a Harbor
  remote env (`--sandbox modal | daytona | e2b | runloop`, with that provider's API key, e.g. `MODAL_TOKEN_ID/SECRET`,
  `DAYTONA_API_KEY`, `E2B_API_KEY`). Docker is not installed on the Mac; the Tenki sandbox `warmpath-qa` has it.
- `uv` (the script pins its deps inline: harbor `feature/harbor-rl-4d0` branch + `tinker-cookbook`).

## Commands (from the repo root)
```bash
python3 harbor/make_tasks.py                      # (re)generate the 20 tasks from the live API / fallback leads
export TINKER_API_KEY=...                         # billing must be active

# smoke run: 4 tasks, Docker sandboxes, Qwen3-8B LoRA
uv run --script harbor/rl/train.py --max-tasks 4 --group-size 4 -b 4 --sandbox docker

# all 20 tasks on Modal (no local Docker)
uv run --script harbor/rl/train.py --model Qwen/Qwen3-8B --group-size 4 -b 4 --sandbox modal
```
Defaults: `Qwen/Qwen3-8B`, LoRA rank 16, lr 4e-5, 512 max tokens, 3 turns, group 4, batch 4 → 20 tasks = 5 steps
per epoch. For a cheaper run pass a smaller Tinker model (e.g. `--model meta-llama/Llama-3.2-1B`). Logs and
checkpoints go to `logs/kindred-outreach/`.

## Baseline eval without training (no Tinker needed)
```bash
cd harbor
harbor run -p kindred-outreach -a oracle -c config.yaml            # reference drafts → reward 1.0
harbor run -p kindred-outreach -a <agent> -m <model> -c config.yaml # any Harbor agent, per-check means via config.yaml
```
`config.yaml` swaps Harbor's default single-key `mean` metric for `metrics/per_dimension.py` (multi-reward recipe),
because `reward.json` has one key per check plus `reward`.
