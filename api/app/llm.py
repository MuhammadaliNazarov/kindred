"""Claude via the anthropic SDK, JSON out. Falls back to a canned result when no key or on any error."""
from __future__ import annotations

import json
import os
import re
from typing import Any, Callable

from . import thinking

_client = None


def live() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def model() -> str:
    return os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")


def _get_client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic()
    return _client


def _parse(text: str) -> Any:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1)
    start = min([i for i in (text.find("{"), text.find("[")) if i != -1], default=0)
    return json.loads(text[start:])


def json_call(agent: str, system: str, prompt: str, fallback: Callable[[], Any], max_tokens: int = 4000) -> tuple[Any, bool]:
    """Returns (data, was_live)."""
    if not live():
        thinking.emit(agent, "reason", "No ANTHROPIC_API_KEY — using deterministic fallback")
        return fallback(), False
    try:
        thinking.emit(agent, "reason", f"Asking {model()}…")
        msg = _get_client().messages.create(
            model=model(),
            max_tokens=max_tokens,
            system=system + "\nRespond with ONLY valid JSON. No prose, no markdown fences.",
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        return _parse(text), True
    except Exception as e:
        thinking.emit(agent, "reason", f"Claude call failed ({type(e).__name__}: {str(e)[:120]}) — using fallback")
        return fallback(), False
