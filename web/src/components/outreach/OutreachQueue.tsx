"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import * as Dialog from "@radix-ui/react-dialog";
import { CheckCheck, Lock } from "lucide-react";
import type { AuditEvent, Company, Lead, Person, Signal, ThinkingStep, Touch } from "@/lib/types";
import { getCompanies, getLeads, getPeople, getTouches, reviewTouch } from "@/lib/api";
import { useThinking } from "@/components/shell/context";
import { Badge, Btn, Skeleton, TierBadge, fmtTime, uid } from "./bits";
import { TouchCard } from "./TouchCard";
import { buttonClass } from "@/components/ui/Button";

type Action = "approve" | "edit" | "reject";

const ACTION_STATUS: Record<Action, Touch["status"]> = { approve: "approved", edit: "edited", reject: "rejected" };

export function OutreachQueue() {
  const { push } = useThinking();
  const [touches, setTouches] = useState<Touch[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([getTouches(), getLeads(), getPeople(), getCompanies()])
      .then(([t, l, p, c]) => {
        if (!alive) return;
        setTouches(t);
        setLeads(l);
        setPeople(p);
        setCompanies(c);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const signalById = useMemo(() => {
    const m = new Map<string, Signal>();
    companies.forEach((c) => c.signals.forEach((s) => m.set(s.id, s)));
    return m;
  }, [companies]);

  const rows = useMemo(() => {
    const byLead = new Map<string, Touch[]>();
    touches.forEach((t) => {
      const arr = byLead.get(t.lead_id) ?? [];
      arr.push(t);
      byLead.set(t.lead_id, arr);
    });
    return leads
      .filter((l) => byLead.has(l.id))
      .map((l) => {
        const ts = (byLead.get(l.id) ?? []).sort((a, b) => a.step - b.step);
        return {
          lead: l,
          person: personById.get(l.person_id),
          company: companyById.get(l.company_id),
          touches: ts,
          pending: ts.filter((t) => t.status === "draft").length,
        };
      })
      .sort((a, b) => b.pending - a.pending || (b.company?.score ?? 0) - (a.company?.score ?? 0));
  }, [touches, leads, personById, companyById]);

  const current = rows.find((r) => r.lead.id === selected) ?? rows[0];
  const totalPending = rows.reduce((n, r) => n + r.pending, 0);
  const passing = touches.filter((t) => t.status === "draft" && t.review.verdict === "pass" && t.security.verdict === "pass");

  function leadLabel(leadId: string) {
    const l = leads.find((x) => x.id === leadId);
    const p = l && personById.get(l.person_id);
    const c = l && companyById.get(l.company_id);
    return [p?.name, c?.name].filter(Boolean).join(" · ") || leadId;
  }

  function log(t: Touch, action: Action, agent: "reviewer" | "planner") {
    const now = new Date().toISOString();
    const verb = action === "approve" ? "approved" : action === "edit" ? "edited" : "rejected";
    const step: ThinkingStep = {
      id: uid("th"),
      at: now,
      agent,
      kind: "handoff",
      text:
        action === "approve"
          ? `Rep approved step ${t.step} (${t.channel}) for ${leadLabel(t.lead_id)}. Handing to dispatch queue.`
          : action === "edit"
            ? `Rep edited step ${t.step} for ${leadLabel(t.lead_id)}. Re-queued for Reviewer check.`
            : `Rep rejected step ${t.step} for ${leadLabel(t.lead_id)}. Planner will redraft.`,
    };
    push(step);
    setAudit((a) => [
      { id: uid("au"), at: now, actor: "rep", agent, action: `touch_${verb}`, lead_id: t.lead_id, detail: `Step ${t.step} ${t.channel}, variant ${t.variant}` },
      ...a,
    ]);
  }

  async function act(t: Touch, action: Action, body?: { subject?: string; body: string }) {
    if (action === "approve" && t.security.verdict === "fail") return;
    setBusy(t.id);
    const optimistic: Touch = { ...t, ...(body ?? {}), status: ACTION_STATUS[action] };
    setTouches((ts) => ts.map((x) => (x.id === t.id ? optimistic : x)));
    try {
      const res = (await reviewTouch(t.id, action, body?.body)) as unknown;
      if (res && typeof res === "object" && "id" in res && "status" in res) {
        const updated = res as Touch;
        setTouches((ts) => ts.map((x) => (x.id === t.id ? { ...x, ...updated } : x)));
        if (action === "approve" && updated.status === "sent")
          push({ id: uid("th"), at: new Date().toISOString(), agent: "builder", kind: "handoff",
            text: `Sent step ${t.step} (${t.channel}) for ${leadLabel(t.lead_id)} to the demo inbox; outreach_sent metered, lead → contacted.` });
      }
    } catch {
      /* keep optimistic state for the demo */
    } finally {
      setBusy(null);
    }
    log(t, action, action === "reject" ? "planner" : "reviewer");
  }

  async function approveAllPassing() {
    setConfirmOpen(false);
    for (const t of passing) {
      await act(t, "approve");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 px-8 pb-6 pt-8">
        <div>
          <h1 className="k-title">
            Outreach, <span className="k-accent">reviewed</span> before it sends
          </h1>
          <p className="k-sub">
            {totalPending} drafts awaiting review · {rows.length} leads · {passing.length} passing both checks
          </p>
        </div>
        <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              disabled={passing.length === 0}
              className={buttonClass("primary")}
            >
              <CheckCheck className="h-4 w-4" /> Approve all passing ({passing.length})
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="scrim fixed inset-0 z-40" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 glass-3 rounded-[16px] p-5">
              <Dialog.Title className="font-serif text-lg text-neutral-900">Approve {passing.length} drafts?</Dialog.Title>
              <Dialog.Description className="mt-1.5 text-[13px] text-neutral-600">
                Only drafts where the Reviewer and Security agents both returned <b>pass</b> are included. Each approval is logged under
                your name in the audit log.
              </Dialog.Description>
              <ul className="mt-3 max-h-40 overflow-auto border-y border-neutral-200 py-1 text-[12px] text-neutral-700">
                {passing.map((t) => (
                  <li key={t.id} className="flex justify-between py-0.5 tabular-nums">
                    <span className="truncate">{leadLabel(t.lead_id)}</span>
                    <span className="text-neutral-500">
                      step {t.step} · {t.channel}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Btn variant="ghost">Cancel</Btn>
                </Dialog.Close>
                <Btn variant="primary" onClick={approveAllPassing}>
                  Approve {passing.length}
                </Btn>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      {/* HITL banner */}
      <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-6 py-2 text-[12px] text-emerald-300">
        <Lock className="h-3.5 w-3.5" />
        <span className="font-medium">Nothing is sent without human approval.</span>
        <span className="text-emerald-300">Every touch waits here for a rep click. LinkedIn is never sent by API; copy it and send by hand.</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr]">
        {/* Lead list */}
        <aside className="min-h-0 overflow-auto border-r border-neutral-200">
          <div className="sticky top-0 grid grid-cols-[1fr_auto] border-b border-neutral-200 bg-panel px-4 py-1.5 text-[11px] font-medium tracking-wider text-neutral-500">
            <span>Lead</span>
            <span>Drafts</span>
          </div>
          {loading && (
            <div className="space-y-px p-2" aria-busy>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-2">
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                  <Skeleton className="h-5 w-6" />
                </div>
              ))}
            </div>
          )}
          {!loading && rows.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-neutral-500">
              <div className="font-medium text-neutral-700">Queue is empty</div>
              <div className="mt-1">Run Discovery and enrich a buyer; the Builder drafts a 3-touch sequence here.</div>
            </div>
          )}
          {rows.map((r, i) => {
            const active = current?.lead.id === r.lead.id;
            return (
              <button
                key={r.lead.id}
                type="button"
                onClick={() => setSelected(r.lead.id)}
                style={{ "--i": i } as React.CSSProperties}
                className={clsx(
                  "no-press wp-rise relative grid w-full grid-cols-[1fr_auto] items-center gap-2 border-b border-neutral-100 px-4 py-2 text-left",
                  active ? "bg-neutral-100" : "hover:bg-neutral-50",
                )}
              >
                {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" aria-hidden />}
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-neutral-900">{r.person?.name ?? r.lead.person_id}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                    <span className="truncate">{r.company?.name ?? r.lead.company_id}</span>
                    {r.company && <TierBadge tier={r.company.tier} />}
                  </div>
                </div>
                <span
                  className={clsx(
                    "min-w-6 rounded-sm px-1.5 text-center text-[12px] font-medium tabular-nums",
                    r.pending ? "bg-accent text-white" : "bg-neutral-100 text-neutral-400",
                  )}
                >
                  {r.pending}
                </span>
              </button>
            );
          })}
        </aside>

        {/* Sequence */}
        <section className="min-h-0 overflow-auto bg-neutral-50/50 px-6 py-4">
          {current ? (
            <>
              <div className="mb-3 flex flex-wrap items-baseline gap-2">
                <h2 className="text-[20px] text-neutral-950">{current.person?.name}</h2>
                <span className="text-[13px] text-neutral-600">
                  {current.person?.title}
                  {current.company ? `, ${current.company.name}` : ""}
                </span>
                {current.company && <TierBadge tier={current.company.tier} />}
                {current.company && <Badge>{`Score ${current.company.score}`}</Badge>}
                <Badge>{`Variant ${current.lead.variant}`}</Badge>
                {current.person?.enrichment.email && (
                  <Badge tone={current.person.enrichment.email_status === "valid" ? "ok" : "warn"}>
                    {current.person.enrichment.email} · {current.person.enrichment.email_status}
                  </Badge>
                )}
              </div>
              <div className="grid gap-3">
                {current.touches.map((t, i) => (
                  <TouchCard
                    key={t.id}
                    index={i}
                    touch={t}
                    signal={signalById.get(t.signal_id)}
                    busy={busy === t.id}
                    onApprove={(x) => act(x, "approve")}
                    onEdit={(x, b) => act(x, "edit", b)}
                    onReject={(x) => act(x, "reject")}
                  />
                ))}
              </div>
            </>
          ) : (
            (loading ? (
              <div className="space-y-3" aria-busy>
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-[220px]" />
                <Skeleton className="h-[220px] opacity-60" />
              </div>
            ) : (
              <div className="text-[13px] text-neutral-500">Select a lead.</div>
            ))
          )}

          {/* Session audit */}
          <div className="mt-6">
            <h3 className="mb-1.5 font-serif text-base text-neutral-900">Review log (this session)</h3>
            <table className="w-full border border-neutral-200 bg-surface text-[12px] tabular-nums">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-[11px] tracking-wider text-neutral-500">
                  <th className="px-2 py-1 font-medium">Time</th>
                  <th className="px-2 py-1 font-medium">Actor</th>
                  <th className="px-2 py-1 font-medium">Action</th>
                  <th className="px-2 py-1 font-medium">Lead</th>
                  <th className="px-2 py-1 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-2 text-neutral-400">
                      No decisions yet.
                    </td>
                  </tr>
                )}
                {audit.map((e) => (
                  <tr key={e.id} className="border-b border-neutral-100">
                    <td className="px-2 py-1 text-neutral-500">{fmtTime(e.at)}</td>
                    <td className="px-2 py-1">
                      <Badge tone="dark">Rep</Badge> <span className="text-neutral-500">via {e.agent}</span>
                    </td>
                    <td className="px-2 py-1">{e.action}</td>
                    <td className="px-2 py-1">{e.lead_id ? leadLabel(e.lead_id) : ""}</td>
                    <td className="px-2 py-1 text-neutral-600">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
