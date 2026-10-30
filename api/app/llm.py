"""Claude, JSON out. Provider chain:

1. ANTHROPIC_API_KEY set        -> anthropic SDK                       (mode "anthropic")
2. `claude` CLI on PATH / CLAUDE_CODE_OAUTH_TOKEN set
                                -> `claude -p ... --output-format json` (mode "claude-cli"),
                                   i.e. the Claude subscription Claude Code is logged into
3. otherwise / on any error     -> deterministic fallback               (mode "fallback")

A provider that fails authentication (401/403, CLI not logged in) is marked dead for the process, so every later call
falls straight through to the next provider instead of retrying it; `mode()` (and therefore /health) reflects that.
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
_dead: dict[str, str] = {}  # provider -> why it is unusable (cached auth failure; never retried)
CLI_TIMEOUT = int(os.getenv("CLAUDE_CLI_TIMEOUT", "90"))
_AUTH_RE = re.compile(r"not logged in|log ?in|invalid api key|authentication|unauthori[sz]ed|\b401\b|\b403\b|permission denied", re.I)


def _cli_path() -> str | None:
    return os.getenv("CLAUDE_CLI") or shutil.which("claude")


def _usable(provider: str) -> bool:
    if provider in _dead:
        return False
    return bool(os.getenv("ANTHROPIC_API_KEY")) if provider == "anthropic" else bool(_cli_path())


def mode() -> str:
    forced = os.getenv("LLM_PROVIDER", "").strip().lower()
    if forced == "fallback":
        return "fallback"
    order = [forced] if forced in ("anthropic", "claude-cli") else ["anthropic", "claude-cli"]
    if forced == "anthropic":
        order.append("claude-cli")  # a forced-but-dead key still falls through to the local login
    return next((p for p in order if _usable(p)), "fallback")


def detail() -> str | None:
    """Why a provider was skipped (e.g. 'anthropic: 401 authentication_error'), for /health."""
    return "; ".join(f"{k}: {v}" for k, v in _dead.items()) or None


def live() -> bool:
    return mode() != "fallback"


def model(provider: str | None = None) -> str:
    if (provider or mode()) == "claude-cli":
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
        model=model("anthropic"),
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
    if "anthropic" in _dead:
        env.pop("ANTHROPIC_API_KEY", None)  # a key that 401s must not be handed to the CLI either
    env.pop("CLAUDECODE", None)  # allow `claude -p` when the API itself was started from inside a Claude Code session
    cmd = [
        cli, "-p", prompt,
        "--output-format", "json",
        "--model", model("claude-cli"),
        "--system-prompt", system,
        "--tools", "",               # no built-in tools: pure text completion
        "--strict-mcp-config",       # no MCP servers
        "--no-session-persistence",
    ]
    with tempfile.TemporaryDirectory(prefix="kindred-claude-") as cwd:
        proc = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=CLI_TIMEOUT, stdin=subprocess.DEVNULL)
    out = proc.stdout.strip()
    try:
        data = json.loads(out)
    except ValueError:
        raise RuntimeError(f"claude CLI exit {proc.returncode}: {(proc.stderr or out)[:200]}")
    if data.get("is_error") or proc.returncode != 0:
        raise RuntimeError(f"claude CLI error: {str(data.get('result') or proc.stderr)[:200]}")
    return data.get("result") or ""


def _auth_failure(provider: str, e: Exception) -> str | None:
    """A short reason when the error means the provider can never work in this process (bad key / not logged in)."""
    if provider == "anthropic":
        try:
            import anthropic

            if isinstance(e, (anthropic.AuthenticationError, anthropic.PermissionDeniedError)):
                return f"{getattr(e, 'status_code', 401)} {type(e).__name__}"
        except ImportError:
            pass
        return None
    msg = str(e)
    return msg[:120] if ("not found" in msg or _AUTH_RE.search(msg)) else None


def _chain() -> list[str]:
    m = mode()
    if m == "fallback":
        return []
    return [m, "claude-cli"] if m == "anthropic" and _usable("claude-cli") else [m]


def json_call(agent: str, system: str, prompt: str, fallback: Callable[[], Any], max_tokens: int = 4000) -> tuple[Any, bool]:
    """Returns (data, was_live)."""
    system = system + "\nRespond with ONLY valid JSON. No prose, no markdown fences."
    for provider in _chain():
        try:
            thinking.emit(agent, "reason", f"Asking {model(provider)} via {provider}…")
            text = _call_anthropic(system, prompt, max_tokens) if provider == "anthropic" else _call_cli(system, prompt)
            return _parse(text), True
        except Exception as e:
            why = _auth_failure(provider, e)
            if why:
                _dead[provider] = why
                thinking.emit(agent, "reason", f"{provider} unusable ({why}) — disabled for this run; falling through")
                continue
            thinking.emit(agent, "reason", f"Claude call failed ({type(e).__name__}: {str(e)[:120]}) — using fallback")
            break
    else:
        thinking.emit(agent, "reason", f"No usable Claude provider ({detail() or 'no ANTHROPIC_API_KEY, no Claude Code login'}) — using deterministic fallback")
    return fallback(), False
