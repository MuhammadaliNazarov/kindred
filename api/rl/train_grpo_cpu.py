"""CPU-only GRPO (TRL) + LoRA on Kindred outreach prompts. Reward = app.verifier.score (normalised 0-1),
the SAME function as the HITL Reviewer gate. No GPU, no vLLM, fp32.

    cd api/rl && uv sync
    uv run python make_prompts.py --api http://localhost:8040        # optional: real leads -> out/prompts.jsonl
    uv run python train_grpo_cpu.py --steps 40                        # SmolLM2-360M-Instruct by default
    uv run python train_grpo_cpu.py --model Qwen/Qwen2.5-0.5B-Instruct --steps 40
Writes out/train_log.json [{step, reward, kl}] and out/lora/.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from outreach_env import load_rows, score_draft  # noqa: E402

OUT = HERE / "out"


def set_seed(seed: int) -> None:
    import numpy as np
    import torch
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def reward_fn(completions, company, signal, quote, allowed_domains, **_):
    texts = [c[-1]["content"] if isinstance(c, list) else c for c in completions]
    return [score_draft({"company": co, "signal": s, "quote": q, "allowed_domains": ad}, t)[0]
            for t, co, s, q, ad in zip(texts, company, signal, quote, allowed_domains)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="HuggingFaceTB/SmolLM2-360M-Instruct")
    ap.add_argument("--steps", type=int, default=40)
    ap.add_argument("--prompts", default=None, help="prompts.jsonl from make_prompts.py (default out/prompts.jsonl if present)")
    ap.add_argument("--num-generations", type=int, default=4)
    ap.add_argument("--max-completion-length", type=int, default=120)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--beta", type=float, default=0.04)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--threads", type=int, default=os.cpu_count() or 4)
    a = ap.parse_args()

    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import TrainerCallback
    from trl import GRPOConfig, GRPOTrainer

    torch.set_num_threads(a.threads)
    set_seed(a.seed)
    rows = [r for r in load_rows(a.prompts) if r["split"] == "train"]  # eval split is never trained on
    random.Random(a.seed).shuffle(rows)
    ds = Dataset.from_list([{"prompt": [{"role": "user", "content": r["prompt_text"]}], "company": r["company"],
                             "signal": r["signal"], "quote": r.get("quote", ""), "allowed_domains": r["allowed_domains"]}
                            for r in rows])
    print(f"train prompts: {len(ds)} | model {a.model} | steps {a.steps} | threads {a.threads}")

    OUT.mkdir(parents=True, exist_ok=True)
    log: list[dict] = []
    t0 = time.time()

    class LogReward(TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kw):
            if logs and "reward" in logs:
                log.append({"step": state.global_step, "reward": round(float(logs["reward"]), 4),
                            "kl": round(float(logs["kl"]), 6) if "kl" in logs else None,
                            "elapsed_s": round(time.time() - t0, 1)})
                (OUT / "train_log.json").write_text(json.dumps(log, indent=1))
                print(f"step {state.global_step}: reward {log[-1]['reward']} kl {log[-1]['kl']} ({log[-1]['elapsed_s']}s)", flush=True)

    cfg = GRPOConfig(
        output_dir=str(OUT / "grpo-ckpt"), max_steps=a.steps, learning_rate=a.lr, beta=a.beta,
        per_device_train_batch_size=a.num_generations, num_generations=a.num_generations,  # 1 prompt x G completions / step
        gradient_accumulation_steps=1, max_completion_length=a.max_completion_length, temperature=1.0,
        use_vllm=False, use_cpu=True, bf16=False, fp16=False, logging_steps=1, save_strategy="no",
        report_to="none", seed=a.seed, dataloader_num_workers=0, gradient_checkpointing=False,
    )
    trainer = GRPOTrainer(
        model=a.model, reward_funcs=reward_fn, args=cfg, train_dataset=ds, callbacks=[LogReward()],
        peft_config=LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules="all-linear", task_type="CAUSAL_LM"),
    )
    trainer.train()
    trainer.save_model(str(OUT / "lora"))
    (OUT / "lora" / "base_model.txt").write_text(a.model)
    print(f"saved LoRA -> {OUT / 'lora'} | {len(log)} logged steps | {time.time() - t0:.0f}s total")


if __name__ == "__main__":
    main()
