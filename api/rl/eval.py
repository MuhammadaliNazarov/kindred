"""Held-out eval: base vs base+LoRA on the fixed eval split (companies never seen in training), scored by app.verifier.

    cd api/rl && uv run python eval.py --model HuggingFaceTB/SmolLM2-360M-Instruct --lora out/lora --n 30
    uv run python eval.py --model HuggingFaceTB/SmolLM2-360M-Instruct --n 30      # base only (trained fields null)
Writes out/eval.json (served by GET /model/eval).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from outreach_env import MAX_SCORE, load_rows, score_draft  # noqa: E402

OUT = HERE / "out"
METRICS = [  # (name, check-name prefix or None for avg reward)
    ("avg reward", None),
    ("cites signal %", "cites the signal"),
    ("no banned claims %", "no outcome guarantees"),
    ("length ok %", "30–90 words"),
    ("ends with question %", "ends with a question"),
]


def generate(model, tok, prompts: list[str], max_new: int, bs: int) -> list[str]:
    import torch
    out: list[str] = []
    tok.padding_side = "left"
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    for i in range(0, len(prompts), bs):
        chunk = [tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True)
                 for p in prompts[i:i + bs]]
        enc = tok(chunk, return_tensors="pt", padding=True)
        with torch.no_grad():
            gen = model.generate(**enc, max_new_tokens=max_new, do_sample=False, pad_token_id=tok.pad_token_id)
        out += [tok.decode(g[enc["input_ids"].shape[1]:], skip_special_tokens=True).strip() for g in gen]
        print(f"  generated {min(i + bs, len(prompts))}/{len(prompts)}", flush=True)
    return out


def score_all(rows, texts):
    res = []
    for r, t in zip(rows, texts):
        reward, raw, checks = score_draft(r, t)
        res.append({"reward": reward, "raw": raw, "checks": {c["name"]: c["pass"] for c in checks}})
    return res


def agg(res, prefix):
    if prefix is None:
        return round(sum(x["reward"] for x in res) / len(res), 4)
    hits = [next((v for k, v in x["checks"].items() if k.startswith(prefix)), False) for x in res]
    return round(100 * sum(hits) / len(hits), 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="HuggingFaceTB/SmolLM2-360M-Instruct")
    ap.add_argument("--lora", default=None)
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--prompts", default=None)
    ap.add_argument("--max-new-tokens", type=int, default=120)
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--threads", type=int, default=os.cpu_count() or 4)
    a = ap.parse_args()

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    torch.set_num_threads(a.threads)
    torch.manual_seed(0)
    rows = [r for r in load_rows(a.prompts) if r["split"] == "eval"]
    rows = sorted(rows, key=lambda r: (r["company"], r["template"]))[: a.n]  # fixed, deterministic held-out set
    prompts = [r["prompt_text"] for r in rows]
    t0 = time.time()
    tok = AutoTokenizer.from_pretrained(a.model)
    model = AutoModelForCausalLM.from_pretrained(a.model, dtype=torch.float32).eval()
    print(f"eval on {len(rows)} held-out prompts | base {a.model}")
    base_txt = generate(model, tok, prompts, a.max_new_tokens, a.batch_size)
    base = score_all(rows, base_txt)

    trained, tr_txt = None, None
    if a.lora:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, a.lora).eval()
        print(f"trained = base + LoRA {a.lora}")
        tr_txt = generate(model, tok, prompts, a.max_new_tokens, a.batch_size)
        trained = score_all(rows, tr_txt)

    metrics = [{"name": n, "base": agg(base, p), "trained": agg(trained, p) if trained else None} for n, p in METRICS]
    order = sorted(range(len(rows)), key=lambda i: -((trained[i]["reward"] - base[i]["reward"]) if trained else base[i]["reward"]))
    examples = [{"company": rows[i]["company"], "base_text": base_txt[i], "trained_text": tr_txt[i] if tr_txt else None,
                 "base_score": base[i]["raw"], "trained_score": trained[i]["raw"] if trained else None} for i in order[:3]]
    log_p = OUT / "train_log.json"
    curve = json.loads(log_p.read_text()) if (a.lora and log_p.exists()) else []
    result = {"status": "done", "model_base": a.model, "model_trained": (f"{a.model} + LoRA ({a.lora})" if a.lora else None),
              "n": len(rows), "max_raw_score": MAX_SCORE, "reward": "app.verifier.score normalised to [0,1] (same as HITL gate)",
              "split": "held-out companies (fixed sha1 group split), never in training",
              "metrics": metrics, "examples": examples,
              "training": {"steps": curve[-1]["step"] if curve else 0,
                           "reward_curve": [c["reward"] for c in sorted(curve, key=lambda c: c["step"])]},
              "elapsed_s": round(time.time() - t0, 1)}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "eval.json").write_text(json.dumps(result, indent=1))
    for m in metrics:
        print(f"{m['name']:>22}: base {m['base']}  trained {m['trained']}")
    print(f"wrote {OUT / 'eval.json'} in {result['elapsed_s']}s")


if __name__ == "__main__":
    main()
