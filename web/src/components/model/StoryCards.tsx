"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { EnvReset, EnvStep, PreferenceStats } from "@/lib/types";
import { envReset, envStep, exportPreferencesUrl, getPreferenceStats } from "@/lib/api";
import { Btn } from "@/components/outreach/bits";
import { Card } from "./Card";

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-2xl tabular-nums text-neutral-900">{value}</div>
      <div className="text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}

export function PreferenceCard() {
  const [stats, setStats] = useState<PreferenceStats | null>(null);
  useEffect(() => {
    let alive = true;
    getPreferenceStats().then((s) => alive && setStats(s)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const url = exportPreferencesUrl();
  return (
    <Card n={1} title="Preference data" sample={stats?.sample}>
      <p className="mb-3 text-[12px] text-neutral-600">
        Each approve / edit / reject on a drafted touch becomes a (chosen, rejected) pair. Edits are the strongest signal: the rep&rsquo;s
        rewrite beats the model&rsquo;s draft.
      </p>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat label="pairs" value={stats?.pairs ?? "–"} />
        <Stat label="from humans" value={stats?.from_human ?? "–"} />
        <Stat label="synthetic" value={stats?.synthetic ?? "–"} />
      </div>
      <div className="mt-auto">
        {url ? (
          <a href={url} className="inline-flex h-7 items-center rounded-sm border border-neutral-300 px-2.5 text-[12px] font-medium text-neutral-800 hover:bg-neutral-50">
            Download JSONL
          </a>
        ) : (
          <span className="text-[11px] text-neutral-500">Download JSONL needs the API (set NEXT_PUBLIC_API_URL).</span>
        )}
      </div>
    </Card>
  );
}

export function EnvCard() {
  const [ep, setEp] = useState<EnvReset | null>(null);
  const [draft, setDraft] = useState("");
  const [res, setRes] = useState<EnvStep | null>(null);
  const [busy, setBusy] = useState(false);

  async function reset() {
    setBusy(true);
    setRes(null);
    try {
      setEp(await envReset());
    } finally {
      setBusy(false);
    }
  }
  async function step() {
    if (!ep) return;
    setBusy(true);
    try {
      setRes(await envStep(ep.episode_id, draft));
    } finally {
      setBusy(false);
    }
  }

  const o = ep?.observation;
  return (
    <Card n={2} title="RL environment" sample={ep?.sample || res?.sample}>
      <p className="mb-2 text-[12px] text-neutral-600">
        <code className="text-[11px]">reset()</code> → a lead + one cited signal. <code className="text-[11px]">step(draft)</code> → reward from the
        verifier. One-step episodes; GRPO samples a group of drafts per lead.
      </p>
      <div className="mb-2 flex items-center gap-2">
        <Btn onClick={reset} disabled={busy}>{ep ? "New episode" : "Try it: reset()"}</Btn>
        {ep && <span className="truncate text-[11px] tabular-nums text-neutral-400">{ep.episode_id}</span>}
      </div>
      {o && (
        <div className="mb-2 border border-neutral-200 bg-neutral-50 p-2 text-[12px]">
          <div className="font-medium text-neutral-900">
            {[o.person, o.title, o.company].filter(Boolean).join(" · ") || "Observation"}
          </div>
          {o.signal && <div className="mt-0.5 text-neutral-700">Signal: {o.signal}</div>}
          {o.source_quote && <div className="mt-0.5 italic text-neutral-500">“{o.source_quote}”</div>}
          {o.source_url && (
            <a href={o.source_url} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[11px] text-neutral-500 underline">
              {o.source_url}
            </a>
          )}
          {!o.company && !o.signal && <pre className="whitespace-pre-wrap text-[11px]">{JSON.stringify(o, null, 2)}</pre>}
        </div>
      )}
      {ep && (
        <>
          <label htmlFor="env-draft" className="sr-only">Draft</label>
          <textarea
            id="env-draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="Write a 30–90 word draft that names the company, cites the signal, and ends with a question."
            className="mb-2 w-full resize-y border border-neutral-300 p-2 text-[12px] outline-none focus:border-neutral-500"
          />
          <Btn variant="primary" onClick={step} disabled={busy || !draft.trim()}>step(draft)</Btn>
        </>
      )}
      {res && (
        <div className="mt-2 text-[12px]">
          <div className="mb-1 font-medium tabular-nums text-neutral-900">
            Reward {res.reward}
            {res.max !== undefined && <span className="text-neutral-500"> / {res.max}</span>}
          </div>
          <ul className="space-y-0.5">
            {res.checks.map((c) => (
              <li key={c.name} className={c.pass ? "text-emerald-300" : "text-rose-300"}>
                {c.pass ? "✓" : "✗"} {c.name}
                {c.detail && <span className="text-neutral-500"> — {c.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function RewardCard() {
  return (
    <Card n={3} title="Reward">
      <p className="mb-2 text-[12px] text-neutral-600">
        The reward is the <span className="font-medium text-neutral-900">same verifier</span> that gates the human-in-the-loop queue. No
        learned reward model to hack: the model is trained on exactly what a rep must approve.
      </p>
      <ul className="mb-3 space-y-0.5 text-[12px] text-neutral-700">
        <li>+1 names the company</li>
        <li>+1 cites the signal</li>
        <li>+1 ends with a question CTA</li>
        <li>+0.5 / −0.5 30–90 words</li>
        <li>+1 every claim has a source</li>
        <li>−2 outcome guarantees · −1 off-domain links</li>
      </ul>
      <div className="mt-auto text-[12px]">
        <Link href="/outreach" className="text-neutral-900 underline underline-offset-2">See it gate the Outreach queue →</Link>
      </div>
    </Card>
  );
}
