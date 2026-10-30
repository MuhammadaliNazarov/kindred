"""Claude, JSON out. Provider chain:

1. ANTHROPIC_API_KEY set        -> anthropic SDK                       (mode "anthropic")
2. `claude` CLI on PATH / CLAUDE_CODE_OAUTH_TOKEN set
                                -> `claude -p ... --output-format json` (mode "claude-cli"),
                                   i.e. the Claude subscription Claude Code is logged into
3. otherwise / on any error     -> deterministic fallback               (mode "fallback")

LLM_PROVIDER=anthropic|claude-cli|fallback forces a mode.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from typing import Any, Callable

from . import thinking

_client = None
CLI_TIMEOUT = int(os.getenv("CLAUDE_CLI_TIMEOUT", "90"))


def _cli_path() -> str | None:
    return os.getenv("CLAUDE_CLI") or shutil.which("claude")


def mode() -> str:
    forced = os.getenv("LLM_PROVIDER", "").strip().lower()
    if forced in ("anthropic", "claude-cli", "fallback"):
        return forced
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    if _cli_path():  # works with the local Claude Code login or CLAUDE_CODE_OAUTH_TOKEN
        return "claude-cli"
    return "fallback"


def live() -> bool:
    return mode() != "fallback"


def model() -> str:
    if mode() == "claude-cli":
        return os.getenv("CLAUDE_CLI_MODEL", "sonnet")
    return os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")


def _get_client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic()
    return _client


def _first_json(text: str) -> str:
    """Return the first balanced JSON object/array in text (string-aware)."""
    starts = [i for i in (text.find("{"), text.find("[")) if i != -1]
    if not starts:
        return text
    start = min(starts)
    stack: list[str] = []
    in_str = esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            if not stack or stack.pop() != ch:
                break
            if not stack:
                return text[start : i + 1]
    return text[start:]


def _parse(text: str) -> Any:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1)
    return json.loads(_first_json(text))


def _call_anthropic(system: str, prompt: str, max_tokens: int) -> str:
    msg = _get_client().messages.create(
        model=model(),
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")


def _call_cli(system: str, prompt: str) -> str:
    cli = _cli_path()
    if not cli:
        raise RuntimeError("claude CLI not found on PATH")
    env = dict(os.environ)
    if not env.get("ANTHROPIC_API_KEY"):
        env.pop("ANTHROPIC_API_KEY", None)  # empty key from .env must not shadow the subscription login
    cmd = [
        cli, "-p", prompt,
        "--output-format", "json",
        "--model", model(),
        "--system-prompt", system,
        "--tools", "",               # no built-in tools: pure text completion
        "--strict-mcp-config",       # no MCP servers
        "--no-session-persistence",
    ]
    with tempfile.TemporaryDirectory(prefix="warmpath-claude-") as cwd:
        proc = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=CLI_TIMEOUT, stdin=subprocess.DEVNULL)
    out = proc.stdout.strip()
    try:
        data = json.loads(out)
    except ValueError:
        raise RuntimeError(f"claude CLI exit {proc.returncode}: {(proc.stderr or out)[:200]}")
    if data.get("is_error") or proc.returncode != 0:
        raise RuntimeError(f"claude CLI error: {str(data.get('result') or proc.stderr)[:200]}")
    return data.get("result") or ""


def json_call(agent: str, system: str, prompt: str, fallback: Callable[[], Any], max_tokens: int = 4000) -> tuple[Any, bool]:
    """Returns (data, was_live)."""
    m = mode()
    if m == "fallback":
        thinking.emit(agent, "reason", "No ANTHROPIC_API_KEY and no Claude Code login — using deterministic fallback")
        return fallback(), False
    system = system + "\nRespond with ONLY valid JSON. No prose, no markdown fences."
    try:
        thinking.emit(agent, "reason", f"Asking {model()} via {m}…")
        text = _call_anthropic(system, prompt, max_tokens) if m == "anthropic" else _call_cli(system, prompt)
        return _parse(text), True
    except Exception as e:
        thinking.emit(agent, "reason", f"Claude call failed ({type(e).__name__}: {str(e)[:120]}) — using fallback")
        return fallback(), False
