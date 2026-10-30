"""Flexprice metering + credit gate.

LIVE (FLEXPRICE_API_KEY + FLEXPRICE_CUSTOMER_ID): POST {base}/events (x-api-key) for every metered event and read the
customer's wallet (GET {base}/customers/wallets?lookup_key=...&include_real_time_balance=true) for the balance.
FALLBACK: local ledger in data/ledger.json starting at DEMO_CREDITS (default 400). Costs: enrich 5, send 1, graph 0.1.
The local ledger always tracks `used` so the UI meter works in both modes.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

import httpx
from fastapi import HTTPException

from . import thinking
from .models import Credits, Used

DATA = Path(__file__).resolve().parent.parent / "data"
LEDGER = DATA / "ledger.json"
COSTS = {"lead_enriched": 5.0, "outreach_sent": 1.0, "graph_query": 0.1}
_lock = threading.Lock()
_wallet_cache: tuple[float, float | None] = (0.0, None)


def _granted() -> float:
    return float(os.getenv("DEMO_CREDITS", "400"))


def _base() -> str:
    return os.getenv("FLEXPRICE_BASE_URL", "https://us.api.flexprice.io/v1").rstrip("/")


def live() -> bool:
    return bool(os.getenv("FLEXPRICE_API_KEY") and os.getenv("FLEXPRICE_CUSTOMER_ID"))


def _load() -> dict:
    granted = _granted()
    if LEDGER.exists():
        try:
            d = json.loads(LEDGER.read_text())
            if d.get("granted") == granted:  # DEMO_CREDITS changed -> fresh wallet
                return d
        except Exception:
            pass
    return {"granted": granted, "balance": granted, "used": {k: 0 for k in COSTS}}


def _save(d: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(d, indent=2))


def reset() -> Credits:
    with _lock:
        _save({"granted": _granted(), "balance": _granted(), "used": {k: 0 for k in COSTS}})
    return credits()


def _ingest(event: str, props: dict) -> None:
    def go():
        try:
            r = httpx.post(
                f"{_base()}/events",
                headers={"x-api-key": os.environ["FLEXPRICE_API_KEY"]},
                json={
                    "event_name": event,
                    "external_customer_id": os.environ["FLEXPRICE_CUSTOMER_ID"],
                    "properties": {k: str(v) for k, v in props.items()},
                    "source": "warmpath-api",
                    "timestamp": thinking.now(),
                },
                timeout=6,
            )
            if r.status_code >= 300:
                thinking.emit("billing", "meter", f"Flexprice ingest {event} -> HTTP {r.status_code}")
        except Exception as e:  # never break the product on billing errors
            thinking.emit("billing", "meter", f"Flexprice ingest failed ({type(e).__name__}); local ledger kept")

    threading.Thread(target=go, daemon=True).start()


def _live_balance() -> float | None:
    global _wallet_cache
    ts, val = _wallet_cache
    if time.time() - ts < 5:
        return val
    val = None
    h = {"x-api-key": os.environ["FLEXPRICE_API_KEY"]}
    cid = os.environ["FLEXPRICE_CUSTOMER_ID"]
    for url, params in [
        (f"{_base()}/customers/wallets", {"lookup_key": cid, "include_real_time_balance": "true"}),
        (f"{_base()}/customers/{cid}/wallets", {"include_real_time_balance": "true"}),
    ]:
        try:
            r = httpx.get(url, headers=h, params=params, timeout=5)
            if r.status_code == 200:
                data = r.json()
                ws = data if isinstance(data, list) else data.get("items") or data.get("wallets") or [data]
                if ws:
                    w = ws[0]
                    for k in ("real_time_credit_balance", "credit_balance", "real_time_balance", "balance"):
                        if w.get(k) is not None:
                            val = float(w[k])
                            break
                if val is not None:
                    break
        except Exception:
            continue
    _wallet_cache = (time.time(), val)
    return val


def credits() -> Credits:
    with _lock:
        d = _load()
    balance = d["balance"]
    if live():
        lb = _live_balance()
        if lb is not None:
            balance = lb
    return Credits(
        balance=round(balance, 2),
        granted=d["granted"],
        used=Used(**{k: round(v, 2) for k, v in d["used"].items()}),
        blocked=balance < COSTS["lead_enriched"],
    )


def check(event: str, agent: str = "enricher", lead_id: str | None = None) -> None:
    """Raise 402 if the wallet can't cover `event`. Emits the 'paused' thinking step."""
    c = credits()
    if c.balance < COSTS[event]:
        thinking.emit(agent, "meter", f"Enrichment paused — out of credits (balance {c.balance}, need {COSTS[event]})")
        from . import state
        state.log("ai", "credits_blocked", f"{event} blocked: balance {c.balance}", agent=agent, lead_id=lead_id)
        raise HTTPException(status_code=402, detail={"error": "out_of_credits", "credits": c.model_dump()})


def meter(event: str, quiet: bool = False, **props) -> None:
    cost = COSTS[event]
    with _lock:
        d = _load()
        d["balance"] = max(0.0, round(d["balance"] - cost, 4))
        d["used"][event] = round(d["used"].get(event, 0) + cost, 4)
        _save(d)
    if live():
        _ingest(event, props)
    if not quiet:
        thinking.emit("billing", "meter", f"Metered {event} (−{cost} credits){' → Flexprice' if live() else ' (local ledger)'}")


def check_and_meter(event: str, **props) -> None:
    check(event, lead_id=props.get("lead_id"))
    meter(event, **props)
