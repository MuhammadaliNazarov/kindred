"""Post-training surface: DPO preference dataset from the HITL queue, OpenEnv-style RL env over HTTP, and model eval files.

Every human review becomes data:
  edit   -> (rejected = original draft, chosen = edited text)            source "human_edit"
  reject -> (rejected = draft, chosen = approved sibling / higher-verifier draft)  source "human_reject"
  plus synthetic pairs from verifier score gaps between drafts of the same lead      source "verifier"
"""
from __future__ import annotations

import json
import threading
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

import sys

from . import state

_API = str(Path(__file__).resolve().parent.parent)
if _API not in sys.path:
    sys.path.insert(0, _API)
from rl.outreach_env import OutreachEnv, fallback_tasks, observation, score_draft  # noqa: E402  (api dir is on sys.path)

API_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = API_DIR / "rl" / "out"
EVENTS_PATH = API_DIR / "data" / "hitl_events.jsonl"
SYNTH_MIN_GAP = 0.1  # min normalised reward gap for a synthetic verifier pair

router = APIRouter()
_lock = threading.Lock()
_originals: dict[str, dict] = {}  # touch_id -> {"body", "subject"} as first drafted (before any human edit)
_events: list[dict] = []
_episodes: dict[str, dict] = {}


# ---------- HITL capture (called from main.review_touch) ----------
def remember_original(touch) -> None:
    with _lock:
        _originals.setdefault(touch.id, {"body": touch.body, "subject": touch.subject})


def record_review(touch, action: str) -> None:
    orig = _originals.get(touch.id, {"body": touch.body})
    ev = {"touch_id": touch.id, "lead_id": touch.lead_id, "step": touch.step, "channel": touch.channel,
          "action": action, "original": orig["body"], "final": touch.body}
    with _lock:
        _events.append(ev)
        try:
            EVENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
            with EVENTS_PATH.open("a") as f:
                f.write(json.dumps(ev) + "\n")
        except OSError:
            pass  # in-memory copy still serves the export


def _all_events() -> list[dict]:
    with _lock:
        if not _events and EVENTS_PATH.exists():
            _events.extend(json.loads(l) for l in EVENTS_PATH.read_text().splitlines() if l.strip())
        return list(_events)


# ---------- tasks from real leads ----------
def task_for_lead(lead) -> Optional[dict]:
    co, p = state.companies.get(lead.company_id), state.people.get(lead.person_id)
    if not co:
        return None
    sig = state.best_signal(co)
    if not sig:
        return None
    product = state.intake.product_name if state.intake else "Tenki"
    product_url = state.intake.product_url if state.intake else "https://tenki.cloud"
    pdom = product_url.split("//")[-1].split("/")[0]
    return {"company": co.name, "domain": co.domain or "", "buyer_role": p.title if p else "Head of Engineering", "person": p.name if p else "",
            "signal": sig.summary, "quote": sig.source.quote, "source_url": sig.source.url, "lead_id": lead.id,
            "product": product, "product_url": product_url, "allowed_domains": [d for d in (pdom, co.domain) if d],
            "source": "lead"}


def live_tasks() -> list[dict]:
    out = [t for t in (task_for_lead(l) for l in list(state.leads.values())) if t]
    return out or fallback_tasks()


# ---------- preferences ----------
def _pairs() -> list[dict]:
    pairs: list[dict] = []
    events = _all_events()
    touches = list(state.touches.values())
    tasks = {l.id: task_for_lead(l) for l in state.leads.values()}

    def prompt_for(lead_id: str) -> Optional[str]:
        t = tasks.get(lead_id)
        return observation(t, 0)["instructions"] if t else None

    def reward(lead_id: str, text: str) -> float:
        t = tasks.get(lead_id)
        return score_draft(t, text)[0] if t else 0.0

    for ev in events:
        prompt = prompt_for(ev["lead_id"])
        if not prompt:
            continue
        if ev["action"] == "edit" and ev["final"].strip() and ev["final"].strip() != ev["original"].strip():
            pairs.append({"prompt": prompt, "chosen": ev["final"], "rejected": ev["original"], "source": "human_edit",
                          "touch_id": ev["touch_id"]})
        elif ev["action"] == "reject":
            sibs = [t for t in touches if t.lead_id == ev["lead_id"] and t.id != ev["touch_id"] and t.channel == ev["channel"]]
            approved = [t for t in sibs if t.status in ("approved", "sent")]
            rej_r = reward(ev["lead_id"], ev["final"])
            chosen = max(approved, key=lambda t: reward(t.lead_id, t.body), default=None)
            if chosen is None:
                better = [t for t in sibs if reward(t.lead_id, t.body) > rej_r]
                chosen = max(better, key=lambda t: reward(t.lead_id, t.body), default=None)
            if chosen is not None:
                pairs.append({"prompt": prompt, "chosen": chosen.body, "rejected": ev["final"], "source": "human_reject",
                              "touch_id": ev["touch_id"]})
    # synthetic: verifier gaps between drafts of the same lead + channel (incl. pre-edit originals)
    by_lead: dict[tuple, list[str]] = {}
    for t in touches:
        texts = by_lead.setdefault((t.lead_id, t.channel), [])
        for txt in (t.body, _originals.get(t.id, {}).get("body")):
            if txt and txt not in texts:
                texts.append(txt)
    for (lead_id, _ch), texts in by_lead.items():
        prompt = prompt_for(lead_id)
        if not prompt or len(texts) < 2:
            continue
        scored = sorted(((reward(lead_id, x), x) for x in texts), reverse=True)
        for i in range(len(scored)):
            for j in range(i + 1, len(scored)):
                if scored[i][0] - scored[j][0] >= SYNTH_MIN_GAP:
                    pairs.append({"prompt": prompt, "chosen": scored[i][1], "rejected": scored[j][1], "source": "verifier",
                                  "synthetic": True, "margin": round(scored[i][0] - scored[j][0], 4)})
    return pairs


@router.get("/preferences/stats")
def preference_stats():
    ps = _pairs()
    human = sum(1 for p in ps if p["source"] in ("human_edit", "human_reject"))
    return {"pairs": len(ps), "from_human": human, "synthetic": len(ps) - human,
            "by_source": {s: sum(1 for p in ps if p["source"] == s) for s in ("human_edit", "human_reject", "verifier")},
            "hitl_events": len(_all_events())}


@router.get("/export/preferences")
def export_preferences():
    body = "".join(json.dumps({k: p[k] for k in ("prompt", "chosen", "rejected", "source")}) + "\n" for p in _pairs())
    return Response(body, media_type="application/x-ndjson",
                    headers={"Content-Disposition": 'attachment; filename="kindred_preferences.jsonl"'})


# ---------- RL environment over HTTP ----------
class ResetBody(BaseModel):
    seed: Optional[int] = None


class StepBody(BaseModel):
    episode_id: str
    draft: str = Field(min_length=1, max_length=8000)


@router.get("/env/tasks")
def env_tasks():
    """Raw tasks (one per real lead) — make_prompts.py writes these to rl/out/prompts.jsonl."""
    return live_tasks()


@router.post("/env/reset")
def env_reset(body: ResetBody = ResetBody()):
    env = OutreachEnv(live_tasks())
    obs = env.reset(body.seed)
    eid = uuid.uuid4().hex[:12]
    with _lock:
        if len(_episodes) > 5000:
            _episodes.pop(next(iter(_episodes)))
        _episodes[eid] = {"env": env, "done": False}
    return {"episode_id": eid, "observation": obs}


@router.post("/env/step")
def env_step(body: StepBody):
    ep = _episodes.get(body.episode_id)
    if not ep:
        raise HTTPException(404, "unknown episode_id (call /env/reset)")
    if ep["done"]:
        raise HTTPException(409, "episode already done (single-step env)")
    reward, done, info = ep["env"].step(body.draft)
    ep["done"] = done
    return {"reward": reward, "max": 1.0, "done": done, "checks": info["checks"], "raw_score": info["raw_score"], "max_score": info["max_score"]}


# ---------- model eval / train log ----------
def _read_json(name: str, default):
    p = OUT_DIR / name
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return default


@router.get("/model/eval")
def model_eval():
    ev = _read_json("eval.json", {"status": "not_run"})
    tr = ev.get("training") if isinstance(ev, dict) else None
    if tr and tr.get("reward_curve") and isinstance(tr["reward_curve"][0], dict):
        tr["reward_curve"] = [c["reward"] for c in tr["reward_curve"]]  # UI wants number[] in step order
    return ev


@router.get("/model/train-log")
def model_train_log():
    return [{"step": r["step"], "reward": r["reward"], **({"kl": r["kl"]} if r.get("kl") is not None else {})}
            for r in _read_json("train_log.json", []) if isinstance(r, dict)]
