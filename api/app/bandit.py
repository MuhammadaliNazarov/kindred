"""Reply-learning outreach: Thompson-sampling bandit over message variants (hook × CTA).

Arm stats are Beta(replies+1, no_replies+1), persisted to api/data/bandit.json.
Real rewards come from pipeline moves (replied → 1, closed_lost after a send → 0) and POST /webhooks/reply.
POST /bandit/simulate runs SIMULATED replies on a copy of the policy (flagged simulated:true) for the demo.
"""
from __future__ import annotations

import json
import random
import threading
from pathlib import Path

from . import thinking

HOOKS = {
    "signal_hook": "Lead with the cited signal (what happened, when)",
    "warmpath_hook": "Lead with the warm-path connector (shared ex-employer)",
}
CTAS = {
    "call": "Worth a 15-min call this week?",
    "doc": "Want the one-page agent-sandbox architecture doc?",
}
ARMS = [f"{h}__{c}" for h in HOOKS for c in CTAS]
# SIMULATED true reply rates for the demo only (never used for real rewards).
SIM_TRUE_RATES = {"signal_hook__call": 0.04, "signal_hook__doc": 0.07, "warmpath_hook__call": 0.06, "warmpath_hook__doc": 0.11}

PATH = Path(__file__).resolve().parent.parent / "data" / "bandit.json"
_lock = threading.RLock()


def split(arm: str) -> tuple[str, str]:
    h, _, c = arm.partition("__")
    return h, c


class ThompsonPolicy:
    def __init__(self, stats: dict | None = None, history: list | None = None):
        self.stats = {a: list((stats or {}).get(a, [1, 1])) for a in ARMS}  # [alpha, beta]
        self.history: list[dict] = list(history or [])

    def choose(self, rng: random.Random | None = None) -> str:
        r = rng or random
        return max(self.stats, key=lambda a: r.betavariate(*self.stats[a]))

    def update(self, arm: str, reward: int) -> None:
        if arm not in self.stats:
            return
        self.stats[arm][0 if reward else 1] += 1

    def shares(self, draws: int = 400, rng: random.Random | None = None) -> dict[str, float]:
        """Thompson traffic share = P(arm is picked) estimated by Monte Carlo."""
        r = rng or random.Random(7)
        wins = {a: 0 for a in ARMS}
        for _ in range(draws):
            wins[self.choose(r)] += 1
        return {a: round(w / draws, 3) for a, w in wins.items()}

    def snapshot(self, step: int) -> None:
        self.history.append({"step": step, "shares": self.shares()})
        if len(self.history) > 200:
            self.history = self.history[-200:]

    def sent(self) -> int:
        return sum(a + b - 2 for a, b in self.stats.values())

    def summary(self, simulated: bool) -> dict:
        sh = self.shares()
        arms = []
        for a, (al, be) in self.stats.items():
            h, c = split(a)
            arms.append({"id": a, "hook": h, "cta": c, "hook_text": HOOKS[h], "cta_text": CTAS[c],
                         "sent": al + be - 2, "replies": al - 1, "mean": round(al / (al + be), 3), "share": sh[a]})
        return {"arms": arms, "history": self.history, "simulated": simulated, "total_sent": self.sent()}


_real: ThompsonPolicy | None = None
_sim: ThompsonPolicy | None = None
_rewarded: dict[str, int] = {}  # lead_id -> reward already applied (idempotent)


def _load() -> None:
    global _real, _sim, _rewarded
    if _real is not None:
        return
    data = {}
    try:
        data = json.loads(PATH.read_text())
    except Exception:
        pass
    _real = ThompsonPolicy(data.get("stats"), data.get("history"))
    _sim = ThompsonPolicy(data["sim"]["stats"], data["sim"]["history"]) if data.get("sim") else None
    _rewarded = data.get("rewarded", {})


def _save() -> None:
    try:
        PATH.parent.mkdir(parents=True, exist_ok=True)
        PATH.write_text(json.dumps({"stats": _real.stats, "history": _real.history, "rewarded": _rewarded,
                                    "sim": {"stats": _sim.stats, "history": _sim.history} if _sim else None}, indent=1))
    except Exception:
        pass


def policy() -> ThompsonPolicy:
    with _lock:
        _load()
        return _real


def choose() -> str:
    with _lock:
        _load()
        return _real.choose()


def _leader(p: ThompsonPolicy) -> tuple[str, float, float]:
    sh = p.shares()
    best = max(sh, key=sh.get)
    a, b = p.stats[best]
    return best, round(a / (a + b), 3), sh[best]


def update(arm: str, reward: int, lead_id: str | None = None) -> bool:
    """Apply a real reward. Idempotent per lead. Returns True if applied."""
    with _lock:
        _load()
        if arm not in _real.stats:
            return False
        if lead_id is not None:
            if lead_id in _rewarded:
                return False
            _rewarded[lead_id] = int(bool(reward))
        _real.update(arm, reward)
        _real.snapshot(_real.sent())
        _save()
        best, mean, share = _leader(_real)
    thinking.emit("planner", "reason", f"Bandit: {arm} got reward {int(bool(reward))}"
                  f"{' (lead ' + lead_id + ')' if lead_id else ''}; shifting traffic to {best} (p={mean}, share {share:.0%})")
    return True


def summary() -> dict:
    with _lock:
        _load()
        return (_sim or _real).summary(simulated=_sim is not None)


def simulate(sends: int = 300, seed: int | None = None) -> dict:
    """SIMULATED replies on a copy of the real policy. Never touches real stats."""
    global _sim
    rng = random.Random(seed)
    with _lock:
        _load()
        p = ThompsonPolicy(_real.stats, [])
        p.snapshot(0)
        every = max(1, sends // 30)
        for i in range(1, sends + 1):
            arm = p.choose(rng)
            p.update(arm, int(rng.random() < SIM_TRUE_RATES[arm]))
            if i % every == 0 or i == sends:
                p.snapshot(i)
        _sim = p
        _save()
        best, mean, share = _leader(p)
    thinking.emit("planner", "reason", f"Bandit (SIMULATED, {sends} sends): shifting traffic to {best} (p={mean}, share {share:.0%})")
    return summary()


def reset_sim() -> dict:
    global _sim
    with _lock:
        _load()
        _sim = None
        _save()
    return summary()


def reset_all() -> dict:
    """Clear the simulated overlay AND the real reply-learned stats (demo reset)."""
    global _real, _sim, _rewarded
    with _lock:
        _real, _sim = ThompsonPolicy(None, None), None
        _rewarded = {}
        _real.snapshot(0)
        _save()
    return summary()
