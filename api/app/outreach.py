"""3-touch sequences (email, email, linkedin) from one cited signal + warm path + persona rules; Reviewer + Security
checks; HITL review; SendGrid send forced to DEMO_INBOX."""
from __future__ import annotations

import json
import logging
import os
import re
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from . import bandit, billing, graph, llm, pipeline, state, thinking, verifier
from .models import Review, Security, Touch

log = logging.getLogger("warmpath.outreach")

PERSONA_RULES = {
    "c-level": "Lead with business outcome and speed; max 90 words; no jargon.",
    "director": "Lead with the team's roadmap pain; mention build-vs-buy; max 110 words.",
    "ic": "Be technical and concrete (cold-start, isolation, API); max 120 words.",
}

COPY_SYSTEM = """You are the Builder/Copy agent. Write a 3-touch outbound sequence (step 1 email, step 2 email, step 3 LinkedIn note under 300 chars).
Rules: open with the ONE cited signal (say what and when, in plain words); only state facts present in the signal or warm path;
mention the warm path connector by first name if one exists; no links except the product URL given; no emails/phone numbers;
no tracking links. Variant A = signal-led subject; Variant B = warm-path/question-led subject.
Follow the "hook" (how step 1 opens) and "cta" (the closing question) given in the input exactly. Step 1 email body: 30-90 words,
name the company, and end with the CTA as a question. Never promise or guarantee outcomes.
House style for both emails (from our reviewer): open with "Congratulations on ..." the cited signal (the raise, the launch, the new hire;
for a job post: congratulate them on growing the team); spend the body on the job posting or the problem it reveals, not on us;
then the CTA question; then sign off exactly as three lines: "Yours sincerely," / sender name / sender role (both given in the input).
Return {"touches":[{"step":1,"channel":"email","subject":str,"body":str},{"step":2,"channel":"email","subject":str,"body":str},{"step":3,"channel":"linkedin","body":str}]}"""


def _first(name: str) -> str:
    # Role-only buyers ("Head of Infrastructure @ Greptile") have no real name: never greet them as "Hi Head".
    if not name or " @ " in name or "(to find)" in name:
        return "there"
    return name.split()[0]


SENDER_NAME = os.getenv("SENDER_NAME", "Ali")
SENDER_ROLE = os.getenv("SENDER_ROLE", "GTM Lead, Tenki")
SIGNATURE = f"Yours sincerely,\n{SENDER_NAME}\n{SENDER_ROLE}"


def _congrats(co, sig) -> str:
    t = sig.type
    if t == "funding":
        return f"Congratulations on the raise at {co.name}!"
    if t in ("job_post", "exec_hire"):
        return f"Congratulations on growing the {co.name} team!"
    if t == "launch":
        return f"Congratulations on the launch at {co.name}!"
    return f"Congratulations on the progress at {co.name}!"


def _fallback(person, co, sig, hops, variant, product, product_url, arm: str | None = None) -> dict:
    # hops (edge direction kept): You→PastCo, Connector→PastCo, Connector→TargetCo, Buyer→TargetCo
    connector = hops[0].to if hops else None
    connector_person = hops[1].from_ if len(hops) >= 3 else None
    warm = f"{connector_person} and I both worked at {connector}, so happy to have {_first(connector_person)} intro us if easier. " if connector_person and connector else ""
    sig_line = f"Saw {co.name}'s {sig.type.replace('_', ' ')} on {sig.date}: {sig.summary}."
    if variant == "A":
        summ = sig.summary if len(sig.summary) <= 60 else sig.summary[:60].rsplit(" ", 1)[0].rstrip(",;:-—") + "…"  # cut at a word
        s1 = f"{co.name}: {summ}"
    else:
        s1 = f"{'Via ' + _first(connector_person) + ' — ' if connector_person else ''}sandboxes at {co.name}?"
    hook, cta = bandit.split(arm) if arm else ("signal_hook" if variant == "A" else "warmpath_hook", "call")
    cta_line = bandit.CTAS.get(cta, "Worth a short look?")
    congrats = _congrats(co, sig)
    body1 = (f"Hi {_first(person.name)},\n\n{congrats} {warm if hook == 'warmpath_hook' else ''}{sig_line}\n\n"
             f"A {sig.type.replace('_', ' ')} like that usually means someone has to build and run sandbox infra for agent code. {product} ({product_url}) gives you that as an API, "
             f"so {co.name} engineers stay on the product.\n\n{warm if hook != 'warmpath_hook' else ''}{cta_line}\n\n{SIGNATURE}")
    body2 = (f"Hi {_first(person.name)},\n\n{congrats} Following up on the {sig.type.replace('_', ' ')} from {sig.date}: "
             f"if the sandbox work is already scoped, I can share how {product} would fit. Would a short plan help?\n\n{SIGNATURE}")
    body3 = f"Hi {_first(person.name)} — saw {co.name}'s {sig.type.replace('_', ' ')} ({sig.date}). Building agent sandboxes? Would love to compare notes."
    return {"touches": [
        {"step": 1, "channel": "email", "subject": s1, "body": body1},
        {"step": 2, "channel": "email", "subject": f"Re: {s1}", "body": body2},
        {"step": 3, "channel": "linkedin", "body": body3[:300]},
    ]}


# ---------------- Reviewer ----------------
STOP = set("the a an and or to of in on for at by with is are was were be this that it its your you we our i from as about".split())
CLAIM_HINT = re.compile(r"\d|raised|hiring|hired|launch|announc|post|migrat|series|seed|funding|joined|outage|pricing", re.I)


def _words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9$%]+", s.lower()) if w not in STOP and len(w) > 2}


def review(t: Touch, lead) -> Review:
    sources = state.lead_sources(lead)
    if not sources:
        return Review(verdict="fail", notes="Lead has no sources; no claim can be supported.")
    co = state.companies.get(lead.company_id)
    ctx_txt = " ".join([s.quote + " " + s.title for s in sources] + [g.summary + " " + g.date + " " + g.type.replace("_", " ") for g in (co.signals if co else [])])
    # warm-path facts are graph facts (cited by the graph itself)
    ctx_txt += " " + " ".join(f"{h.from_} {h.rel} {h.to}" for h in state_warm.get(lead.id, []))
    ctx = _words(ctx_txt) | _words((co.name if co else "") + " " + (state.intake.product_name if state.intake else ""))
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", t.body + " " + (t.subject or "")) if s.strip()]
    unsupported = []
    for s in sentences:
        if not CLAIM_HINT.search(s) or s.endswith("?"):  # the CTA question is not a factual claim
            continue
        w = _words(s)
        if w and len(w & ctx) / len(w) < 0.4:
            unsupported.append(s[:90])
    sig = next((g for g in (co.signals if co else []) if g.id == t.signal_id), None)
    if sig and not sig.source.verified:
        note = "Signal source is demo/unverified (verified:false). "
    else:
        note = ""
    allowed = [(co.domain if co else "") or "", urlparse(state.intake.product_url).netloc if state.intake else "tenki.cloud"]
    v = verifier.verify(t.body, co.name if co else "", (sig.summary + " " + sig.type.replace("_", " ")) if sig else "",
                        context=ctx_txt, allowed_domains=allowed)
    vnote = f"verifier {v['score']}/{v['max']}. "
    hard_fail = any(not c["pass"] for c in v["checks"])  # any failed verifier check → the rep must fix before approving
    extra = dict(score=v["score"], max_score=v["max"], checks=v["checks"])
    if not unsupported:
        verdict = "fix" if hard_fail else "pass"
        return Review(verdict=verdict, notes=vnote + note + f"All factual claims map to the lead's {len(sources)} source(s).", **extra)
    verdict = "fix" if len(unsupported) <= 2 else "fail"
    return Review(verdict=verdict, notes=vnote + note + "Unsupported claims: " + " | ".join(unsupported), **extra)


# ---------------- Security ----------------
URL_RE = re.compile(r"https?://[^\s)>\]]+", re.I)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?<![\d-])(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d-])")
TRACK_RE = re.compile(r"utm_|pixel|track|open\.gif|beacon|/o/|/wf/open|click\?|[?&](uid|cid|rid|eid)=|\.gif", re.I)


def security(t: Touch, lead) -> Security:
    co = state.companies.get(lead.company_id)
    allowed = {d for d in [co.domain if co else "", urlparse(state.intake.product_url).netloc if state.intake else ""] if d}
    allowed = {d.replace("www.", "") for d in allowed}
    issues = []
    for u in URL_RE.findall(t.body):
        host = urlparse(u).netloc.lower().replace("www.", "")
        if not any(host == d or host.endswith("." + d) for d in allowed):
            issues.append(f"link to non-allowed domain {host}")
        if TRACK_RE.search(u):
            issues.append(f"tracking-style URL {u[:60]}")
    if EMAIL_RE.search(t.body):
        issues.append("email address in body (PII)")
    if PHONE_RE.search(t.body):
        issues.append("phone number in body (PII)")
    if issues:
        return Security(verdict="fail", notes="; ".join(issues))
    return Security(verdict="pass", notes=f"Links only to {', '.join(sorted(allowed)) or 'none'}; no PII beyond name/title; no tracking URLs.")


state_warm: dict[str, list] = {}


def check(t: Touch, lead) -> Touch:
    t.review = review(t, lead)
    t.security = security(t, lead)
    thinking.emit("reviewer", "validate", f"Reviewer on {t.id}: {t.review.verdict} — {t.review.notes[:120]}")
    thinking.emit("security", "validate", f"Security on {t.id}: {t.security.verdict} — {t.security.notes[:120]}")
    return t


def draft(lead_id: str, use_llm: bool = True) -> list[Touch]:
    lead = pipeline.get_lead(lead_id)
    p, co = state.people.get(lead.person_id), state.companies.get(lead.company_id)
    if not p or not co:
        raise HTTPException(404, "person/company missing")
    sig = state.best_signal(co)
    if not sig:
        raise HTTPException(422, "no cited signal for this lead — refusing to write outreach without a 'why now'")
    thinking.emit("planner", "handoff", f"Planner → Builder: draft 3 touches for {p.name} @ {co.name} (variant {lead.variant})")
    hops, _ = graph.warm_path(graph.ME, p.id)
    state_warm[lead.id] = hops
    arm = bandit.choose()
    hook, cta = bandit.split(arm)
    if hook == "warmpath_hook" and not hops:
        arm, hook = f"signal_hook__{cta}", "signal_hook"  # no warm path to lead with
    lead.variant = "A" if hook == "signal_hook" else "B"
    pol = bandit.policy()
    a_, b_ = pol.stats[arm]
    thinking.emit("planner", "reason", f"Bandit: Thompson sample picked {arm} for {co.name} (Beta({a_},{b_}), mean p={a_ / (a_ + b_):.2f})")
    product = state.intake.product_name if state.intake else "Tenki"
    product_url = state.intake.product_url if state.intake else "https://tenki.cloud"
    rules = PERSONA_RULES.get("c-level" if "c" in p.seniority.lower()[:1] else "ic" if p.seniority.lower() == "ic" else "director")
    prompt = json.dumps({"sender": {"name": SENDER_NAME, "role": SENDER_ROLE}, "variant": lead.variant, "product": product, "product_url": product_url, "prospect": {"name": p.name, "title": p.title, "company": co.name},
                         "signal": {"type": sig.type, "summary": sig.summary, "date": sig.date, "source_url": sig.source.url, "quote": sig.source.quote},
                         "warm_path": [h.model_dump() for h in hops], "persona_rules": rules,
                         "hook": bandit.HOOKS[hook], "cta": bandit.CTAS[cta]})
    fb = lambda: _fallback(p, co, sig, hops, lead.variant, product, product_url, arm)
    data = llm.json_call("builder", COPY_SYSTEM, prompt, fb)[0] if use_llm else fb()
    ts = data.get("touches") if isinstance(data, dict) else None
    if not isinstance(ts, list) or len(ts) < 3 or not all(isinstance(t, dict) and isinstance(t.get("body"), str) and t["body"].strip() for t in ts[:3]):
        thinking.emit("builder", "reason", "LLM draft malformed (missing touch body) — using the deterministic template instead")
        data = _fallback(p, co, sig, hops, lead.variant, product, product_url, arm)
    # replace previous drafts for this lead (keep sent ones)
    for tid in [k for k, t in state.touches.items() if t.lead_id == lead_id and t.status != "sent"]:
        del state.touches[tid]
    out = []
    for raw in data["touches"][:3]:
        t = Touch(id=state.new_id("t"), lead_id=lead_id, step=int(raw.get("step", len(out) + 1)), channel="linkedin" if raw.get("channel") == "linkedin" else "email",
                  subject=raw.get("subject") if raw.get("channel") != "linkedin" else None, body=raw["body"], signal_id=sig.id, variant=lead.variant, arm=arm,
                  status="draft", review=Review(verdict="pass", notes=""), security=Security(verdict="pass", notes=""))
        check(t, lead)
        state.touches[t.id] = t
        out.append(t)
    state.log("ai", "drafted", f"3 touches (variant {lead.variant}, arm {arm}) citing {sig.source.url}", agent="builder", lead_id=lead_id)
    thinking.emit("builder", "handoff", f"Builder → HITL queue: {len(out)} drafts await human approval")
    return out


def get_touch(tid: str) -> Touch:
    t = state.touches.get(tid)
    if not t:
        raise HTTPException(404, f"touch {tid} not found")
    return t


def review_touch(tid: str, action: str, actor: str, body: str | None, subject: str | None) -> Touch:
    t = get_touch(tid)
    if t.status == "sent":
        raise HTTPException(409, "already sent")
    lead = pipeline.get_lead(t.lead_id)
    if action == "approve":
        t.status = "approved"
    elif action == "reject":
        t.status = "rejected"
    else:
        if body is not None:
            t.body = body
        if subject is not None:
            t.subject = subject
        t.status = "edited"  # an edit is NOT an approval: the human must click Approve again before it can send
        check(t, lead)
    state.log(actor, f"touch_{action}", f"{t.id} step {t.step} ({t.channel}) → {t.status}", agent=None, lead_id=t.lead_id)
    return t


def _sendgrid(subject: str, body: str) -> tuple[bool, str]:
    key, frm, inbox = os.getenv("SENDGRID_API_KEY"), os.getenv("SENDGRID_FROM"), os.getenv("DEMO_INBOX")
    if not (key and frm and inbox):
        return False, "simulated (no SENDGRID_API_KEY/SENDGRID_FROM/DEMO_INBOX)"
    inbox = inbox.strip()
    # DEMO_INBOX must be ONE address on one of our own domains (DEMO_INBOX_DOMAINS), never a prospect / a list.
    allowed = [d.strip().lower() for d in os.getenv("DEMO_INBOX_DOMAINS", "").split(",") if d.strip()]
    if inbox.count("@") != 1 or any(c in inbox for c in ",; <>") or not allowed or inbox.rsplit("@", 1)[1].lower() not in allowed:
        log.warning("DEMO_INBOX %r rejected (set DEMO_INBOX_DOMAINS to your own domains); simulating send", inbox)
        return False, "simulated (DEMO_INBOX not on DEMO_INBOX_DOMAINS)"
    try:
        r = httpx.post("https://api.sendgrid.com/v3/mail/send", headers={"Authorization": f"Bearer {key}"}, timeout=15, json={
            "personalizations": [{"to": [{"email": inbox}]}], "from": {"email": frm}, "subject": subject,
            "content": [{"type": "text/plain", "value": body}],
            "tracking_settings": {"click_tracking": {"enable": False}, "open_tracking": {"enable": False}}})
    except httpx.HTTPError as e:
        return False, f"simulated (SendGrid error {type(e).__name__})"
    if r.status_code >= 300:
        log.error("SendGrid HTTP %s: %s", r.status_code, r.text[:500])
        raise HTTPException(502, "send failed")
    return True, f"SendGrid → {inbox}"


def send_touch(tid: str, actor: str = "rep") -> Touch:
    t = get_touch(tid)
    if t.status != "approved":
        raise HTTPException(409, f"touch is '{t.status}': only human-approved touches can be sent (HITL)")
    if t.security.verdict != "pass":
        raise HTTPException(422, f"security check failed: {t.security.notes}")
    lead = pipeline.get_lead(t.lead_id)
    p, co = state.people.get(lead.person_id), state.companies.get(lead.company_id)
    if not p or not co:
        raise HTTPException(404, "person/company missing")
    if t.channel == "email":
        billing.check("outreach_sent", agent="builder", lead_id=lead.id)
        banner = f"[DEMO SEND — intended for {p.name}, {p.title} at {co.name}; delivered to the demo inbox only]\n\n"
        live, how = _sendgrid(t.subject or "(no subject)", banner + t.body)
        billing.meter("outreach_sent", lead_id=lead.id, touch_id=t.id, channel="email")
    else:
        how = "LinkedIn task created (copy-to-clipboard; no unofficial API)"
    t.status = "sent"
    graph.add_contacted(p.id, t.channel, t.id)
    thinking.emit("builder", "handoff", f"Sent {t.id} step {t.step}: {how}")
    state.log(actor, "sent", f"{t.id} step {t.step} via {t.channel}: {how}", lead_id=lead.id)
    if lead.stage == "matched":
        pipeline.move(lead.id, "contacted", "ai", agent="builder", why="first touch sent")
    return t
