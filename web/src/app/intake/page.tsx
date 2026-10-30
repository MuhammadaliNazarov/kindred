"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ArrowUp, Check, Loader2, Sparkles } from "lucide-react";
import type { Intake } from "@/lib/types";
import { postIntake } from "@/lib/api";
import { seedIntake } from "@/lib/seed";
import { useThinking } from "@/components/shell/context";

type Msg = { role: "assistant" | "user"; text: string };
type QKey = "basics" | "best" | "acv" | "lost" | "past";

const QUESTIONS: { key: QKey; ask: string }[] = [
  { key: "basics", ask: "Paste your product URL and describe it in about three sentences." },
  { key: "best", ask: "Who is your best customer today, and why do they love you?" },
  { key: "acv", ask: "Roughly what is a deal worth per year (ACV), and how do you price?" },
  { key: "lost", ask: "Tell me about one deal you lost. What did they choose instead, and why?" },
  { key: "past", ask: "Last one: your past employers and schools. I use them to find warm intros." },
];

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

function applyAnswer(form: Intake, key: QKey, text: string): Intake {
  const f = { ...form };
  if (key === "basics") {
    const url = text.match(/https?:\/\/[^\s,]+|[a-z0-9-]+\.(?:cloud|com|io|ai|dev|app|co)\b/i)?.[0] ?? "";
    f.product_url = url && !url.startsWith("http") ? `https://${url}` : url;
    const desc = text.replace(url, "").replace(/^[\s—–:-]+/, "").trim();
    f.description = desc;
    if (url) {
      const h = url.replace(/^https?:\/\//, "").split(/[./]/)[0];
      f.product_name = h.charAt(0).toUpperCase() + h.slice(1);
    }
    const feats = desc.match(/(sandbox\w*|microvms?|github actions runners?|ai code review|runners?|preview urls?)/gi) ?? [];
    f.features = Array.from(new Set(feats.map((x) => x.replace(/^./, (c) => c.toUpperCase()))));
    if (/usage/i.test(desc)) f.pricing_model = "Usage-based";
  }
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
  const [pending, setPending] = useState<QKey | null>("basics");
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const missing = missingKeys(form);

  function answer(text: string, current: Intake = form): Intake {
    if (!pending || !text.trim()) return current;
    const next = applyAnswer(current, pending, text.trim());
    setForm(next);
    setFlash(pending);
    setTimeout(() => setFlash(null), 900);
    const rest = missingKeys(next);
    const nextKey = rest[0] ?? null;
    setMsgs((m) => [
      ...m,
      { role: "user", text: text.trim() },
      nextKey
        ? { role: "assistant", text: QUESTIONS.find((q) => q.key === nextKey)!.ask }
        : { role: "assistant", text: "That's everything I need. Check the form on the right, then generate the ICP." },
    ]);
    setPending(nextKey);
    return next;
  }

  async function runDemo() {
    setDemoRunning(true);
    let cur = EMPTY;
    setForm(EMPTY);
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
      ["icp", "search", "Searching public job posts, funding news and changelogs for buyer signals."],
      ["icp", "graph", `Linking ${form.past_employers?.length ?? 0} past employers/schools to (Me) for warm paths.`],
      ["icp", "validate", "Checking every ICP claim has a source URL and a matching quote."],
    ];
    for (const [agent, kind, text] of steps) {
      push({ id: `intake-${Date.now()}-${stepSeq++}`, at: new Date().toISOString(), agent, kind, text });
      await sleep(350);
    }
    try {
      await postIntake(form);
      push({ id: `intake-${Date.now()}-${stepSeq++}`, at: new Date().toISOString(), agent: "planner", kind: "handoff", text: "ICP ready. Opening the ICP review." });
      router.push("/icp");
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof Intake>(k: K, v: Intake[K]) => setForm((f) => ({ ...f, [k]: v }));
  const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Chat */}
      <section className="flex min-h-0 flex-col border-r border-neutral-200">
        <header className="flex items-end justify-between gap-4 border-b border-neutral-200 px-8 pb-6 pt-8">
          <div>
            <h1 className="k-hero">
              Tell us what you <span className="k-accent">sell</span>
            </h1>
            <p className="k-sub">The agent asks for what is missing and fills the form as you answer.</p>
          </div>
          <button
            onClick={runDemo}
            disabled={demoRunning}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-neutral-200 px-2.5 py-1 text-[12px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> Use Tenki demo
          </button>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {msgs.map((m, i) => (
            <div key={i} className={clsx("wp-fade-in flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={clsx(
                  "max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed",
                  m.role === "user" ? "bg-accent text-white" : "border border-neutral-200 bg-surface text-neutral-800",
                )}
              >
                {m.text}
              </div>
            </div>
          ))}
          <div ref={chatEnd} />
        </div>
        <form
          className="border-t border-neutral-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            answer(input);
            setInput("");
          }}
        >
          <div className="flex items-end gap-2 rounded-lg border border-neutral-200 px-3 py-2 focus-within:border-neutral-400">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  answer(input);
                  setInput("");
                }
              }}
              rows={2}
              placeholder={pending ? "Type your answer…" : "All set. Edit the form or generate the ICP."}
              className="flex-1 resize-none bg-transparent text-[13px] outline-none placeholder:text-neutral-400"
            />
            <button type="submit" disabled={!input.trim() || !pending} className="rounded-md bg-accent p-1.5 text-white disabled:opacity-30" aria-label="Send">
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </form>
      </section>

      {/* Structured form */}
      <section className="flex min-h-0 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <div>
            <h2 className="text-[20px]">Intake</h2>
            <p className="text-[12px] tabular-nums text-neutral-500">
              {5 - missing.length} of 5 sections complete
            </p>
          </div>
          <button
            onClick={generate}
            disabled={busy || missing.includes("basics")}
            className="flex items-center gap-2 rounded-md bg-emerald-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate ICP
          </button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <Group title="Product" done={!missing.includes("basics")} flash={flash === "basics"}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" value={form.product_name} onChange={(v) => set("product_name", v)} />
              <Field label="URL" value={form.product_url} onChange={(v) => set("product_url", v)} mono />
            </div>
            <Field label="Description" value={form.description} onChange={(v) => set("description", v)} area />
            <Field label="Features (comma separated)" value={form.features.join(", ")} onChange={(v) => set("features", list(v))} />
          </Group>
          <Group title="Best customer" done={!missing.includes("best")} flash={flash === "best"}>
            <Field label="Reference customers" value={form.reference_customers.join(", ")} onChange={(v) => set("reference_customers", list(v))} />
          </Group>
          <Group title="Price" done={!missing.includes("acv")} flash={flash === "acv"}>
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
          <Group title="A deal you lost" done={!missing.includes("lost")} flash={flash === "lost"}>
            <Field label="What happened" value={form.lost_deal ?? ""} onChange={(v) => set("lost_deal", v)} area />
          </Group>
          <Group title="Your past employers / schools" done={!missing.includes("past")} flash={flash === "past"} hint="Powers warm paths">
            <Field label="Comma separated" value={(form.past_employers ?? []).join(", ")} onChange={(v) => set("past_employers", list(v))} />
          </Group>
          <Group title="Constraints" done flash={false}>
            <Field label="Rules the agents must follow" value={form.constraints.join(", ")} onChange={(v) => set("constraints", list(v))} />
          </Group>
        </div>
      </section>
    </div>
  );
}

function Group({ title, done, flash, hint, children }: { title: string; done: boolean; flash: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className={clsx("rounded-lg border p-4 transition-colors duration-500", flash ? "border-emerald-400 bg-emerald-50/40" : "border-neutral-200")}>
      <legend className="flex items-center gap-2 px-1 text-[12px] font-medium">
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
      </legend>
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

function Field({ label, value, onChange, area, mono }: { label: string; value: string; onChange: (v: string) => void; area?: boolean; mono?: boolean }) {
  const cls = clsx(
    "w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400",
    mono && "font-mono text-[12px] tabular-nums",
  );
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] tracking-wide text-neutral-500">{label}</span>
      {area ? (
        <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={clsx(cls, "resize-none")} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
    </label>
  );
}
