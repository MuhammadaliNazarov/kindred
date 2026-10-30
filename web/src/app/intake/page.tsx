"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { buttonClass } from "@/components/ui/Button";
import { ArrowRight, ArrowUp, Check, Globe, Loader2, Sparkles } from "lucide-react";
import type { AnalyzeResult, Intake, Source } from "@/lib/types";
import { analyzeCompany, postIntake } from "@/lib/api";
import { seedIntake } from "@/lib/seed";
import { useThinking } from "@/components/shell/context";

type Msg = { role: "assistant" | "user"; text: string; sources?: Source[] };
type QKey = "basics" | "best" | "acv" | "lost" | "past";
// Follow-ups for a single missing basic, so we never repeat the same question.
type AskKey = QKey | "url" | "name" | "desc";

const QUESTIONS: { key: QKey; ask: string }[] = [
  { key: "basics", ask: "Paste your product URL and describe it in about three sentences." },
  { key: "best", ask: "Who is your best customer today, and why do they love you?" },
  { key: "acv", ask: "Roughly what is a deal worth per year (ACV), and how do you price?" },
  { key: "lost", ask: "Tell me about one deal you lost. What did they choose instead, and why?" },
  { key: "past", ask: "Last one: your past employers and schools. I use them to find warm intros." },
];

const ASKS: Record<AskKey, string> = {
  ...(Object.fromEntries(QUESTIONS.map((q) => [q.key, q.ask])) as Record<QKey, string>),
  url: "What's your website? A bare domain like acme.com is fine.",
  name: "What's the product or company name?",
  desc: "In a sentence or two, what do you sell and to whom?",
};

const DEMO_ANSWERS: Record<QKey, string> = {
  basics: `${seedIntake.product_url} — ${seedIntake.description}`,
  best: "Lumenfold Labs (sample). Their coding agent runs every task in our sandboxes, and they moved CI to our runners.",
  acv: "About $18k a year. Usage-based, with $100 free credit to start.",
  lost: seedIntake.lost_deal ?? "",
  past: (seedIntake.past_employers ?? []).join(", "),
};

const EMPTY: Intake = {
  product_name: "",
  product_url: "",
  description: "",
  features: [],
  constraints: ["Public data only", "No sends without human approval"],
  reference_customers: [],
  pricing_model: "",
  acv_usd: null,
  lost_deal: "",
  past_employers: [],
};

function parseAcv(text: string): number | null {
  const m = text.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m)?/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2]?.toLowerCase() === "k") n *= 1000;
  if (m[2]?.toLowerCase() === "m") n *= 1_000_000;
  return Math.round(n);
}

// Finds a URL or a bare domain (acme.io, acme.io/pricing). Skips file names like node.js and emails.
const URL_RE = /https?:\/\/[^\s,]+|(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?:\/[^\s,]*)?/gi;
const NOT_TLD = new Set(["js", "ts", "jsx", "tsx", "py", "md", "txt", "json", "sh", "csv", "pdf", "png", "jpg"]);

function findUrl(text: string): { raw: string; href: string } | null {
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(/[.)\]]+$/, "");
    const i = m.index ?? 0;
    if (i > 0 && text[i - 1] === "@") continue;
    const host = raw.replace(/^https?:\/\//i, "").split("/")[0];
    const tld = host.split(".").pop()?.toLowerCase() ?? "";
    if (!/^https?:/i.test(raw) && NOT_TLD.has(tld)) continue;
    return { raw, href: normalizeUrl(raw) };
  }
  return null;
}

function normalizeUrl(u: string): string {
  const t = u.trim().replace(/[.)\]]+$/, "");
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function nameFromUrl(href: string): string {
  const stem = href.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[./]/)[0] ?? "";
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

const trimSep = (s: string) => s.replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, "").trim();

// "acme.io, Acme, payroll for remote teams…" → url, name "Acme", description = the rest.
function parseBasics(text: string): { url: string; name: string; description: string } {
  const found = findUrl(text);
  const raw = found ? text.replace(found.raw, " ").replace(/\s{2,}/g, " ") : text;
  const rest = trimSep(raw);
  // "url — text" or "url: text" means the text is all description.
  const dashLed = /^\s*(?:[—–:]|-\s)/.test(raw);
  const first = trimSep(rest.split(/[,\n]/)[0] ?? "");
  const short = !dashLed && first && first !== rest && first.length <= 40 && first.split(/\s+/).length <= 4;
  const name = short ? first : found ? nameFromUrl(found.href) : "";
  const description = short ? trimSep(rest.slice(rest.indexOf(first) + first.length)) : rest;
  return { url: found?.href ?? "", name, description };
}

function applyAnswer(form: Intake, key: AskKey, text: string): Intake {
  const f = { ...form };
  if (key === "basics") {
    const b = parseBasics(text);
    if (b.url) f.product_url = b.url;
    if (b.name) f.product_name = b.name;
    if (b.description) f.description = b.description;
    if (/usage/i.test(b.description)) f.pricing_model = "Usage-based";
  }
  if (key === "url") {
    const found = findUrl(text);
    const href = found?.href ?? (/\s/.test(text.trim()) ? "" : normalizeUrl(text));
    if (href) {
      f.product_url = href;
      if (!f.product_name) f.product_name = nameFromUrl(href);
    }
  }
  if (key === "name") f.product_name = text;
  if (key === "desc") f.description = text;
  if (key === "best") f.reference_customers = [text.split(/[.;]/)[0].trim()];
  if (key === "acv") {
    f.acv_usd = parseAcv(text);
    const pm = text.split(/[.;]/).slice(1).join(".").trim();
    if (pm) f.pricing_model = pm;
  }
  if (key === "lost") f.lost_deal = text;
  if (key === "past") f.past_employers = text.split(/,|;|\n/).map((s) => s.trim()).filter(Boolean);
  return f;
}

function missingKeys(f: Intake): QKey[] {
  const out: QKey[] = [];
  if (!f.product_url || !f.description) out.push("basics");
  if (!f.reference_customers.length) out.push("best");
  if (f.acv_usd === null) out.push("acv");
  if (!f.lost_deal) out.push("lost");
  if (!f.past_employers?.length) out.push("past");
  return out;
}

// What is still missing, as specific questions (basics split into url / name / description).
function neededAsks(f: Intake): AskKey[] {
  const out: AskKey[] = [];
  if (!f.product_url) out.push("url");
  if (!f.product_name) out.push("name");
  if (!f.description) out.push("desc");
  return [...out, ...missingKeys(f).filter((k) => k !== "basics")];
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

// Fill only what the user hasn't typed; the user's words always win.
function mergeAnalysis(cur: Intake, res: AnalyzeResult): Intake {
  const next: Intake = { ...cur };
  for (const [k, v] of Object.entries(res.intake) as [keyof Intake, Intake[keyof Intake]][]) {
    if (k === "evidence" || k === "icp_hints" || isEmpty(v)) continue;
    if (isEmpty(cur[k])) (next as Record<string, unknown>)[k] = v;
  }
  if (next.product_url) next.product_url = normalizeUrl(next.product_url);
  next.evidence = res.evidence;
  next.icp_hints = res.icp_hints;
  return next;
}

const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : null);
const hostOf = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let stepSeq = 0;

export default function IntakePage() {
  const router = useRouter();
  const { push } = useThinking();
  const [form, setForm] = useState<Intake>(EMPTY);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", text: "I'll build your ideal customer profile. I only keep claims I can cite." },
    { role: "assistant", text: QUESTIONS[0].ask },
  ]);
  const [pending, setPending] = useState<AskKey | null>("basics");
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const formRef = useRef<Intake>(EMPTY);
  const asked = useRef<Set<AskKey>>(new Set(["basics"]));
  const analyzedUrl = useRef<string | null>(null);
  const [quickUrl, setQuickUrl] = useState("");
  const [quickAbout, setQuickAbout] = useState("");
  const [analyzedOnce, setAnalyzedOnce] = useState(false);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const missing = missingKeys(form);

  function flashGroup(key: string) {
    setFlash(key);
    setTimeout(() => setFlash(null), 900);
  }

  // Ask the next missing thing, never the same question twice.
  function askNext(f: Intake): Msg | null {
    const need = neededAsks(f);
    if (!need.length) {
      setPending(null);
      return { role: "assistant", text: "That's everything I need. Check the form on the right, then generate the ICP." };
    }
    const fresh = need.find((k) => !asked.current.has(k));
    // Keep the chat open for the first missing field, without repeating its question.
    setPending(fresh ?? need[0]);
    if (!fresh) {
      return missingKeys(f).includes("basics")
        ? { role: "assistant", text: "I still need your website and a short description. Add them on the right, or type them here." }
        : { role: "assistant", text: "I have enough to start. Fill in anything else on the right, then generate the ICP." };
    }
    asked.current.add(fresh);
    return { role: "assistant", text: ASKS[fresh] };
  }

  async function analyze(rawUrl: string, name?: string, description?: string) {
    const url = normalizeUrl(rawUrl);
    if (analyzing || !url) return;
    analyzedUrl.current = url;
    setAnalyzing(true);
    setPending(null);
    setMsgs((m) => [...m, { role: "assistant", text: "Reading your website, LinkedIn and socials…" }]);
    push({ id: `intake-${Date.now()}-${stepSeq++}`, at: new Date().toISOString(), agent: "icp", kind: "search", text: `Reading ${hostOf(url)}, its LinkedIn and socials.` });
    try {
      const res = await analyzeCompany(url, name, description);
      const cur = formRef.current;
      if (!res) {
        const follow = askNext(cur);
        setMsgs((m) => [
          ...m,
          { role: "assistant", text: "I couldn't read the site just now. No problem, a few quick answers will do." },
          ...(follow ? [follow] : []),
        ]);
        return;
      }
      const next = mergeAnalysis(cur, res);
      formRef.current = next;
      setForm(next);
      flashGroup("basics");
      const who = next.product_name || hostOf(url);
      const hints = res.icp_hints.filter(Boolean);
      const summary = [
        `Here's what I learned about ${who}: ${res.summary || "not much public detail yet."}`.trim(),
        hints.length ? `I'll target: ${hints.join(", ")}.` : "",
      ].filter(Boolean).join(" ");
      const sources = res.evidence.filter((e) => safeHref(e.url)).slice(0, 5);
      const follow = askNext(next);
      setMsgs((m) => [...m, { role: "assistant", text: summary, sources }, ...(follow ? [follow] : [])]);
    } finally {
      setAnalyzing(false);
      setAnalyzedOnce(true);
    }
  }

  function answer(text: string, current: Intake = form) {
    const t = text.trim();
    const key = pending ?? neededAsks(current)[0];
    if (!key || !t) return;
    const next = applyAnswer(current, key, t);
    formRef.current = next;
    setForm(next);
    flashGroup(key === "url" || key === "name" || key === "desc" ? "basics" : key);
    const isBasics = key === "basics" || key === "url";
    if (isBasics && next.product_url && analyzedUrl.current !== next.product_url) {
      setMsgs((m) => [...m, { role: "user", text: t }]);
      void analyze(next.product_url, next.product_name, next.description);
      return;
    }
    const follow = askNext(next);
    setMsgs((m) => [...m, { role: "user", text: t }, ...(follow ? [follow] : [])]);
  }

  async function runDemo() {
    setDemoRunning(true);
    let cur = EMPTY;
    setForm(EMPTY);
    asked.current = new Set(["basics"]);
    analyzedUrl.current = null;
    for (const q of QUESTIONS) {
      await sleep(550);
      const next = applyAnswer(cur, q.key, DEMO_ANSWERS[q.key]);
      cur = next;
      setForm(next);
      setFlash(q.key);
      const after = missingKeys(next)[0] ?? null;
      setMsgs((m) => [
        ...m,
        { role: "user", text: DEMO_ANSWERS[q.key] },
        after
          ? { role: "assistant", text: QUESTIONS.find((x) => x.key === after)!.ask }
          : { role: "assistant", text: "That's everything I need. Check the form on the right, then generate the ICP." },
      ]);
      setPending(after);
    }
    // Keep the demo's clean product name and feature list.
    setForm((f) => ({ ...f, product_name: seedIntake.product_name, features: seedIntake.features, pricing_model: seedIntake.pricing_model }));
    setTimeout(() => setFlash(null), 900);
    setDemoRunning(false);
  }

  async function generate() {
    setBusy(true);
    const steps: [string, "reason" | "search" | "validate" | "handoff" | "graph", string][] = [
      ["planner", "reason", `Intake complete for ${form.product_name || "the product"}. Planning ICP research.`],
      ["icp", "search", form.evidence?.length ? `Using ${form.evidence.length} sources read from ${hostOf(form.product_url)}.` : "Searching public job posts, funding news and changelogs for buyer signals."],
      ["icp", "graph", `Linking ${form.past_employers?.length ?? 0} past employers/schools to (Me) for warm paths.`],
      ["icp", "validate", "Checking every ICP claim has a source URL and a matching quote."],
    ];
    for (const [agent, kind, text] of steps) {
      push({ id: `intake-${Date.now()}-${stepSeq++}`, at: new Date().toISOString(), agent, kind, text });
      await sleep(350);
    }
    try {
      await postIntake({ ...form, product_url: form.product_url ? normalizeUrl(form.product_url) : "" });
      push({ id: `intake-${Date.now()}-${stepSeq++}`, at: new Date().toISOString(), agent: "planner", kind: "handoff", text: "ICP ready. Opening the ICP review." });
      router.push("/icp");
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof Intake>(k: K, v: Intake[K]) => setForm((f) => ({ ...f, [k]: v }));
  const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

  const basicsMissing = missing.includes("basics");

  return (
    <div className="flex h-[calc(100vh-72px)] min-h-[640px] flex-col px-8 pb-6 pt-8">
      <header className="mb-8 flex items-end justify-between gap-8">
        <div>
          <h1 className="k-hero">
            Tell us what you <span className="k-accent">sell</span>
          </h1>
          <p className="k-sub">Give Kindred AI your website. It reads the site, LinkedIn and socials, fills in your profile, and you can edit anything.</p>
        </div>
        {/* One primary at a time: the demo until the basics exist, then Generate ICP. */}
        <div className="flex shrink-0 items-center gap-3">
          <span id="intake-progress" className="text-[12px] tabular-nums text-neutral-400">
            {5 - missing.length} of 5 sections
          </span>
          <button
            onClick={runDemo}
            disabled={demoRunning}
            className={clsx(buttonClass(basicsMissing ? "primary" : "secondary"), basicsMissing && !demoRunning && "wp-pulse-accent")}
          >
            <Sparkles className="h-4 w-4" /> Use Tenki demo
          </button>
          <button
            onClick={generate}
            disabled={busy || basicsMissing}
            aria-describedby="intake-progress"
            title={basicsMissing ? "Fill in the product basics first" : undefined}
            className={buttonClass(basicsMissing ? "secondary" : "primary")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Generate ICP
          </button>
        </div>
      </header>

      {/* One input: website + who you serve. Kindred AI reads the site and fills the profile. */}
      <form
        className="glass mb-5 flex flex-col gap-3 rounded-[16px] p-4 lg:flex-row lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void analyze(quickUrl, undefined, quickAbout || undefined);
        }}
      >
        <label className="flex flex-1 flex-col gap-1 text-[12px] text-neutral-600">
          Your website
          <input value={quickUrl} onChange={(e) => setQuickUrl(e.target.value)} placeholder="yourcompany.com"
            className="h-11 rounded-[12px] bg-white px-3.5 text-[14px] text-neutral-900 shadow-[inset_0_0_0_1px_#8a93a8] outline-none focus:shadow-[inset_0_0_0_2px_#2f5bff]" />
        </label>
        <label className="flex flex-[2] flex-col gap-1 text-[12px] text-neutral-600">
          Who you sell to, in one sentence (optional)
          <input value={quickAbout} onChange={(e) => setQuickAbout(e.target.value)} placeholder="e.g. Seed-stage SaaS founders in Europe"
            className="h-11 rounded-[12px] bg-white px-3.5 text-[14px] text-neutral-900 shadow-[inset_0_0_0_1px_#8a93a8] outline-none focus:shadow-[inset_0_0_0_2px_#2f5bff]" />
        </label>
        <button type="submit" disabled={analyzing || !quickUrl.trim()}
          className="h-11 shrink-0 rounded-full bg-accent px-5 text-[14px] font-medium text-white shadow-[0_6px_20px_-6px_rgba(47,91,255,0.6)] disabled:opacity-50">
          {analyzing ? "Kindred AI is reading…" : "Analyze with Kindred AI"}
        </button>
      </form>
      {msgs.length > 2 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-[12px] bg-[#eef2ff] px-4 py-3 text-[13px] text-neutral-800">
          <svg width="18" height="18" viewBox="0 0 40 40" aria-hidden="true" className="mt-0.5 shrink-0"><circle cx="15" cy="20" r="10" fill="none" stroke="#2f5bff" strokeWidth="3.2"/><circle cx="25" cy="20" r="10" fill="none" stroke="#9fd3ff" strokeWidth="3.2"/></svg>
          <span><b className="font-medium">Kindred AI:</b> {[...msgs].reverse().find((m) => m.role === "assistant")?.text}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5">
      {/* Chat (kept for keyboard answers; hidden in the single-input layout) */}
      <section className="glass hidden min-h-0 flex-col overflow-hidden rounded-[16px]">
        <div className="glass-band flex h-12 shrink-0 items-center px-5">
          <div className="flex items-center gap-2.5">
            <svg width="22" height="22" viewBox="0 0 40 40" aria-hidden="true"><circle cx="15" cy="20" r="10" fill="none" stroke="#2f5bff" strokeWidth="3.2"/><circle cx="25" cy="20" r="10" fill="none" stroke="#9fd3ff" strokeWidth="3.2"/></svg>
            <h2 className="k-h3">Kindred AI</h2>
            <span className="text-[12px] text-neutral-500">GTM assistant</span>
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
          {msgs.map((m, i) => (
            <div key={i} className={clsx("wp-fade-in flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className="max-w-[85%]">
                <div
                  className={clsx(
                    "rounded-[18px] px-3.5 py-2 text-[13px] leading-relaxed [text-wrap:pretty]",
                    m.role === "user" ? "rounded-br-md bg-accent text-white" : "rounded-bl-md bg-[#f1f3f8] text-neutral-900",
                  )}
                >
                  {m.text}
                </div>
                {m.sources && m.sources.length > 0 && (
                  <ul aria-label="Sources" className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.sources.map((s) => (
                      <li key={s.url}>
                        <a
                          href={safeHref(s.url) ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={s.quote ? `${s.title}\n“${s.quote}”` : s.title}
                          className="inline-flex h-6 max-w-[200px] items-center gap-1 rounded-full bg-white px-2 text-[11px] text-neutral-600 shadow-[inset_0_0_0_1px_#d5dae5] transition-[box-shadow,color] duration-150 ease-out hover:text-neutral-950 hover:shadow-[inset_0_0_0_1px_#8a93a8] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_#2f5bff]"
                        >
                          {s.verified ? <Check className="h-3 w-3 shrink-0 text-emerald-600" aria-label="Verified" /> : <Globe className="h-3 w-3 shrink-0 text-neutral-400" aria-hidden />}
                          <span className="truncate">{s.title || hostOf(s.url)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
          {analyzing && (
            <div role="status" className="wp-fade-in flex items-center gap-2 text-[12px] text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Reading public pages, up to a minute…
            </div>
          )}
          <div ref={chatEnd} />
        </div>
        <form
          className="p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (analyzing) return;
            answer(input);
            setInput("");
          }}
        >
          <div className="flex items-end gap-2 rounded-[18px] bg-white px-3.5 py-2.5 shadow-[inset_0_0_0_1px_#8a93a8] focus-within:shadow-[inset_0_0_0_2px_#2f5bff]">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (analyzing) return;
                  answer(input);
                  setInput("");
                }
              }}
              rows={2}
              aria-label="Your answer"
              placeholder={analyzing ? "Reading your site…" : pending ? "Type your answer…" : "All set. Edit the form or generate the ICP."}
              className="flex-1 resize-none bg-transparent text-[13px] outline-none placeholder:text-neutral-400"
            />
            <button type="submit" disabled={!input.trim() || !pending || analyzing} className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white disabled:opacity-30" aria-label="Send">
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </form>
      </section>

      {/* Structured form */}
      <section className="glass flex min-h-0 flex-col overflow-hidden rounded-[16px]">
        <div className="glass-band flex h-12 shrink-0 items-center justify-between px-5">
          <div className="flex items-baseline gap-2"><h2 className="k-h3">What Kindred understood</h2><span className="text-[12px] text-neutral-500">fills in from your website · edit anything</span></div>
          <span className="text-[12px] tabular-nums text-neutral-400">{5 - missing.length} of 5 complete</span>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-2 [&>fieldset+fieldset]:shadow-[inset_0_1px_0_#eef1f6]">
          <Group flagMissing={analyzedOnce} title="Your product" done={!missing.includes("basics")} flash={flash === "basics"}>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-3">
              <Field label="Name" value={form.product_name} onChange={(v) => set("product_name", v)} />
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field
                    label="URL"
                    value={form.product_url}
                    onChange={(v) => set("product_url", v)}
                    onBlur={() => {
                      const found = findUrl(form.product_url);
                      if (found && analyzedUrl.current !== found.href && !demoRunning) void analyze(found.href, form.product_name, form.description);
                    }}
                    mono
                  />
                </div>
                <button
                  type="button"
                  onClick={() => form.product_url && void analyze(form.product_url, form.product_name, form.description)}
                  disabled={!findUrl(form.product_url) || analyzing}
                  className={clsx(buttonClass("secondary"), "h-[38px] shrink-0")}
                >
                  {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                  Analyze website
                </button>
              </div>
            </div>
            <Field label="Description" value={form.description} onChange={(v) => set("description", v)} area />
            <Field label="Features (comma separated)" value={form.features.join(", ")} onChange={(v) => set("features", list(v))} />
          </Group>
          <Group flagMissing={analyzedOnce} title="Your best customer" done={!missing.includes("best")} flash={flash === "best"}>
            <Field label="Reference customers" value={form.reference_customers.join(", ")} onChange={(v) => set("reference_customers", list(v))} />
          </Group>
          <Group flagMissing={analyzedOnce} title="Price per customer (per year)" done={!missing.includes("acv")} flash={flash === "acv"}>
            <div className="grid grid-cols-[140px_1fr] gap-3">
              <Field
                label="ACV (USD)"
                value={form.acv_usd === null ? "" : String(form.acv_usd)}
                onChange={(v) => set("acv_usd", v.trim() ? parseAcv(v) : null)}
                mono
              />
              <Field label="Pricing model" value={form.pricing_model} onChange={(v) => set("pricing_model", v)} />
            </div>
          </Group>
          <Group flagMissing={analyzedOnce} title="A deal you lost" done={!missing.includes("lost")} flash={flash === "lost"}>
            <Field label="What happened" value={form.lost_deal ?? ""} onChange={(v) => set("lost_deal", v)} area />
          </Group>
          <Group flagMissing={analyzedOnce} title="Your past employers and schools" done={!missing.includes("past")} flash={flash === "past"} hint="Used to find warm intros">
            <Field label="Comma separated" value={(form.past_employers ?? []).join(", ")} onChange={(v) => set("past_employers", list(v))} />
          </Group>
          <Group title="Who to avoid" done flash={false}>
            <Field label="Rules the agents must follow" value={form.constraints.join(", ")} onChange={(v) => set("constraints", list(v))} />
          </Group>
        </div>
      </section>
      </div>
    </div>
  );
}

function Group({ title, done, flash, hint, flagMissing, children }: { title: string; done: boolean; flash: boolean; hint?: string; flagMissing?: boolean; children: React.ReactNode }) {
  const missingFlag = !!flagMissing && !done;
  return (
    <fieldset className={clsx("-mx-2 rounded-[16px] px-2 py-4 transition-colors duration-500", flash && "bg-emerald-50", missingFlag && "bg-rose-50 ring-1 ring-rose-300")}>
      <legend className="sr-only">{title}</legend>
      <div aria-hidden className="mb-3 flex items-center gap-2 text-[13px] font-medium text-neutral-950">
        <span
          className={clsx(
            "flex h-4 w-4 items-center justify-center rounded-full border",
            done ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300",
          )}
        >
          {done && <Check className="h-2.5 w-2.5" />}
        </span>
        {title}
        {hint && <span className="font-normal text-neutral-400">· {hint}</span>}
        {missingFlag && <span className="ml-auto rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-medium text-white">Missing: please fill in</span>}
      </div>
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

function Field({ label, value, onChange, onBlur, area, mono }: { label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; area?: boolean; mono?: boolean }) {
  const cls = clsx(
    "w-full rounded-[10px] border border-transparent bg-white px-3 py-2 text-[13px] text-neutral-950 shadow-[inset_0_0_0_1px_#8a93a8] outline-none focus-visible:border-[#2f5bff] focus:shadow-[inset_0_0_0_1px_#6f8dff]",
    mono && "font-mono text-[12px] tabular-nums",
  );
  return (
    <label className="block">
      <span className="k-label mb-1.5 block">{label}</span>
      {area ? (
        <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={clsx(cls, "resize-none")} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} className={cls} />
      )}
    </label>
  );
}
