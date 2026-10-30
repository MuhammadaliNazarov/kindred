"""Optional post-training: GRPO-tune a small model to write compliant, signal-grounded outreach for Tenki.

The reward is app.verifier.score: the SAME rule-based verifier the Reviewer agent applies in Kindred's HITL gate
(company named, cited signal, question CTA, 30-90 words, claims sourced, no outcome guarantees, allowed links only).
So "the HITL verifier is the GRPO reward" is literally true.

Needs one CUDA GPU (T4 16GB is enough for Qwen2.5-0.5B + LoRA). Written for trl 1.17.x.
Laptop check of the reward only:  cd api && uv run python rl/grpo_outreach.py --check
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # make `app` importable
from app.verifier import score  # noqa: E402  (stdlib-only module)

PRODUCT, PRODUCT_DOMAIN = "Tenki", "tenki.cloud"
# (company, cited signal, buyer title)
SIGNALS = [
    ("Loopwright", "posted a job for a Senior Infrastructure Engineer to run agent code in secure sandboxes", "VP Engineering"),
    ("Agentsmith Labs", "raised a $12M Series A to scale its coding agents", "CTO"),
    ("Kite Payments", "launched an AI agent that executes customer scripts", "Head of Platform"),
    ("Orbit Labs", "announced a migration off self-hosted Firecracker VMs", "Staff Engineer"),
]


def make_prompt(company, signal, title):
    return (f"Write a cold email (30-90 words) to the {title} of {company}, which {signal}. "
            f"We sell {PRODUCT} ({PRODUCT_DOMAIN}): secure sandboxes for AI agents as an API. "
            "Name the company, mention the signal, end with one question as the call to action. "
            "Only link to tenki.cloud. No guarantees or promises.")


def reward_fn(completions, company, signal, **kwargs):
    texts = [c[0]["content"] if isinstance(c, list) else c for c in completions]
    return [score(t, co, s, allowed_domains=[PRODUCT_DOMAIN]) for t, co, s in zip(texts, company, signal)]


def check():
    co, sig = SIGNALS[1][0], SIGNALS[1][1]
    good = (f"Hi Sam, congrats on {co} raising a $12M Series A to scale its coding agents. Teams at that stage often end up "
            f"building sandbox infra for agent code themselves; {PRODUCT} gives you that as an API so engineers stay on the "
            "product. Want the one-page agent-sandbox architecture doc?")
    bad = "We guarantee 100% secure agents! Book now at http://example.com"
    g, b = score(good, co, sig, allowed_domains=[PRODUCT_DOMAIN]), score(bad, co, sig, allowed_domains=[PRODUCT_DOMAIN])
    print("good:", g, "\nbad: ", b)
    assert g > b
    print("reward check OK (same function as the Kindred Reviewer gate)")


def train(model_name, steps):
    from datasets import Dataset
    from peft import LoraConfig
    from trl import GRPOConfig, GRPOTrainer

    rows = [{"prompt": [{"role": "user", "content": make_prompt(*s)}], "company": s[0], "signal": s[1]}
            for s in SIGNALS] * 64
    cfg = GRPOConfig(output_dir="grpo-out", max_steps=steps, per_device_train_batch_size=4,
                     num_generations=4, max_completion_length=160, learning_rate=1e-5,
                     beta=0.04, logging_steps=5, report_to="none", bf16=False, fp16=True)
    trainer = GRPOTrainer(model=model_name, reward_funcs=reward_fn, args=cfg, train_dataset=Dataset.from_list(rows),
                          peft_config=LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"))
    trainer.train()
    trainer.save_model("grpo-out/final")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--steps", type=int, default=200)
    a = ap.parse_args()
    check() if a.check else train(a.model, a.steps)
