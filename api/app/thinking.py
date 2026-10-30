"""In-process pub/sub for Agent Thinking. Thread-safe append-only log; SSE readers poll by index."""
from __future__ import annotations

import asyncio
import itertools
import json
import threading
from datetime import datetime, timezone

from .models import ThinkingStep

_lock = threading.Lock()
_log: list[ThinkingStep] = []
_ids = itertools.count(1)
MAX = 2000


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def emit(agent: str, kind: str, text: str, cypher: str | None = None) -> ThinkingStep:
    step = ThinkingStep(id=f"t{next(_ids)}", at=now(), agent=agent, kind=kind, text=text, cypher=cypher)
    with _lock:
        _log.append(step)
        if len(_log) > MAX:
            del _log[: len(_log) - MAX]
    return step


def history(limit: int = 200) -> list[ThinkingStep]:
    with _lock:
        return list(_log[-limit:])


async def stream(request, backlog: int = 50):
    """Yields sse-starlette dicts. Unnamed events so EventSource.onmessage receives them."""
    with _lock:
        start_id = _log[-backlog].id if len(_log) >= backlog else (_log[0].id if _log else None)
    sent: set[str] = set()
    started = start_id is None
    while True:
        if await request.is_disconnected():
            break
        with _lock:
            snapshot = list(_log)
        for s in snapshot:
            if not started:
                if s.id == start_id:
                    started = True
                else:
                    continue
            if s.id in sent:
                continue
            sent.add(s.id)
            yield {"data": json.dumps(s.model_dump())}
        started = True
        await asyncio.sleep(0.3)
