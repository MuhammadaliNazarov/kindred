"""Optional: CPU DPO + LoRA on the HITL preference export (GET /export/preferences).

    curl -s http://localhost:8040/export/preferences -o out/preferences.jsonl
    ~/rl/bin/python train_dpo_cpu.py --data out/preferences.jsonl --steps 30
Saves out/lora-dpo/. Evaluate with: eval.py --lora out/lora-dpo
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

OUT = Path(__file__).resolve().parent / "out"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="HuggingFaceTB/SmolLM2-360M-Instruct")
    ap.add_argument("--data", default=str(OUT / "preferences.jsonl"))
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--beta", type=float, default=0.1)
    ap.add_argument("--lr", type=float, default=5e-6)
    a = ap.parse_args()

    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from trl import DPOConfig, DPOTrainer

    torch.set_num_threads(os.cpu_count() or 4)
    rows = [json.loads(l) for l in Path(a.data).read_text().splitlines() if l.strip()]
    if not rows:
        raise SystemExit("no preference pairs — review some drafts in the HITL queue first")
    ds = Dataset.from_list([{"prompt": [{"role": "user", "content": r["prompt"]}],
                             "chosen": [{"role": "assistant", "content": r["chosen"]}],
                             "rejected": [{"role": "assistant", "content": r["rejected"]}]} for r in rows])
    print(f"{len(ds)} pairs ({sum(r['source'] != 'verifier' for r in rows)} human) | {a.model}")
    cfg = DPOConfig(output_dir=str(OUT / "dpo-ckpt"), max_steps=a.steps, per_device_train_batch_size=2, learning_rate=a.lr,
                    beta=a.beta, use_cpu=True, bf16=False, fp16=False, logging_steps=1, save_strategy="no", report_to="none")
    trainer = DPOTrainer(model=a.model, args=cfg, train_dataset=ds,
                         peft_config=LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"))
    trainer.train()
    trainer.save_model(str(OUT / "lora-dpo"))
    print(f"saved -> {OUT / 'lora-dpo'}")


if __name__ == "__main__":
    main()
