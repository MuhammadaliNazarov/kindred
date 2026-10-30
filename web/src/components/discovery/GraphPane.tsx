"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Loader2 } from "lucide-react";
import type { Company, GraphData, Person, Signal, WarmPath } from "@/lib/types";
import { SignalChip, SourceList, fmtDate } from "./cells";

// react-force-graph-2d touches window/canvas, so it is client-only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false }) as unknown as ComponentType<any>;

type NodeType = GraphData["nodes"][number]["type"];

export const NODE_COLORS: Record<NodeType, string> = {
  Me: "#10b981", // success
  Company: "#1f2a44", // ink on white
  Person: "#2f5bff", // accent
  Competitor: "#e11d48", // danger
  Signal: "#f59e0b", // warn
  Product: "#7c3aed", // violet
};

type GNode = GraphData["nodes"][number] & { x?: number; y?: number };
type GLink = { source: string | GNode; target: string | GNode; rel: string };

const endId = (e: string | GNode) => (typeof e === "string" ? e : e.id);

export function GraphPane({
  loading,
  graph,
  warmPath,
  company,
  person,
}: {
  loading: boolean;
  graph: GraphData | null;
  warmPath: WarmPath | null;
  company: Company | null;
  person: Person | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 420, h: 320 });

  // Spread nodes out so labels don't collide: stronger repulsion, longer links. The graph mounts
  // lazily (dynamic import), so retry until the ref is live.
  useEffect(() => {
    if (!graph) return;
    let tries = 0;
    let t: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      const fg = fgRef.current;
      if (!fg) {
        if (tries++ < 20) t = setTimeout(apply, 100);
        return;
      }
      try {
        fg.d3Force("charge")?.strength(-200);
        fg.d3Force("link")?.distance(() => 46);
        fg.d3ReheatSimulation?.();
      } catch {
        /* force engine not ready */
      }
    };
    apply();
    return () => {
      if (t) clearTimeout(t);
    };
  }, [graph]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.max(200, Math.floor(r.width)), h: Math.max(200, Math.floor(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
    // The measured box only renders once a company is selected, so re-attach then.
  }, [!!company]); // eslint-disable-line react-hooks/exhaustive-deps

  // Copy so the force engine can mutate positions without touching the source data.
  const data = useMemo(() => {
    if (!graph) return { nodes: [] as GNode[], links: [] as GLink[] };
    return { nodes: graph.nodes.map((n) => ({ ...n })), links: graph.links.map((l) => ({ ...l })) };
  }, [graph]);

  // Hops may reference node ids or labels; resolve both.
  const { pathNodes, pathEdges } = useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Set<string>();
    if (!graph || !warmPath) return { pathNodes: nodes, pathEdges: edges };
    const byKey = new Map<string, string>();
    graph.nodes.forEach((n) => {
      byKey.set(n.id, n.id);
      byKey.set(n.label, n.id);
    });
    warmPath.hops.forEach((h) => {
      const a = byKey.get(h.from) ?? h.from;
      const b = byKey.get(h.to) ?? h.to;
      nodes.add(a);
      nodes.add(b);
      edges.add(`${a}|${b}`);
      edges.add(`${b}|${a}`);
    });
    return { pathNodes: nodes, pathEdges: edges };
  }, [graph, warmPath]);

  const onPath = (l: GLink) => pathEdges.has(`${endId(l.source)}|${endId(l.target)}`);

  // Same pick as the API's state.best_signal (what the email cites): verified sources first, then type, then date.
  const RANK: Record<string, number> = { job_post: 6, funding: 5, exec_hire: 4, launch: 3, tech_change: 3, churn_risk: 2 };
  const topSignal: Signal | undefined = company
    ? [...company.signals].sort(
        (a, b) =>
          Number(b.source.verified) - Number(a.source.verified) ||
          (RANK[b.type] ?? 0) - (RANK[a.type] ?? 0) ||
          b.date.localeCompare(a.date),
      )[0]
    : undefined;

  if (!company) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-[12px] text-neutral-500">
        <svg width="120" height="64" viewBox="0 0 120 64" aria-hidden className="text-neutral-300">
          <line x1="14" y1="48" x2="52" y2="20" stroke="currentColor" strokeWidth="1.5" />
          <line x1="52" y1="20" x2="88" y2="40" stroke="currentColor" strokeWidth="1.5" />
          <line x1="88" y1="40" x2="108" y2="14" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="14" cy="48" r="5" fill="#10b981" />
          <circle cx="52" cy="20" r="4" fill="#2f5bff" />
          <circle cx="88" cy="40" r="4" fill="#2f5bff" />
          <circle cx="108" cy="14" r="5" fill="#1f2a44" />
        </svg>
        <div>
          <div className="font-serif text-[14px] text-neutral-800">Select a company to see who can introduce you</div>
          <div className="mt-0.5">You → ex-colleague → buyer. The warm path and its Cypher appear here.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-200 px-4 py-2.5">
        <div className="font-serif text-[15px] text-neutral-900">{person ? person.name : company.name}</div>
        <div className="text-[11px] text-neutral-500">
          {person ? `${person.title} · ${company.name}` : `${company.domain} · ${company.industry.includes("no LLM") ? "AI / software" : company.industry}`}
        </div>
      </div>

      <div ref={wrapRef} className="relative h-[320px] shrink-0 border-b border-neutral-200 bg-[#fbfcfe] bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.07)_1px,transparent_0)] bg-[length:14px_14px]">
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px] text-neutral-500">
            <div className="relative flex h-10 w-10 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-200/70" />
              <Loader2 className="relative h-4 w-4 animate-spin text-emerald-300" />
            </div>
            Traversing warm paths…
          </div>
        ) : data.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-neutral-500">No graph for this lead yet.</div>
        ) : (
          <div className="wp-fade-in h-full">
            <ForceGraph2D
              ref={fgRef}
              width={size.w}
              height={size.h}
              graphData={data}
              backgroundColor="rgba(0,0,0,0)"
              cooldownTicks={120}
              d3AlphaDecay={0.03}
              d3VelocityDecay={0.3}
              nodeRelSize={4}
              linkLabel={(l: GLink) => l.rel}
              nodeLabel={(n: GNode) => `${n.type}: ${n.label}`}
              linkColor={(l: GLink) => (onPath(l) ? "#10b981" : "rgba(15,23,42,0.14)")}
              linkWidth={(l: GLink) => (onPath(l) ? 2.5 : 1)}
              linkDirectionalArrowLength={3}
              linkDirectionalArrowRelPos={1}
              linkDirectionalParticles={(l: GLink) => (onPath(l) ? 2 : 0)}
              linkDirectionalParticleColor={() => "#2f5bff"}
              onEngineStop={() => {
                // Fit once the layout settles; a second pass catches the last drift after reheat.
                fgRef.current?.zoomToFit?.(300, 36);
                setTimeout(() => fgRef.current?.zoomToFit?.(300, 36), 700);
              }}
              nodeCanvasObject={(n: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
                const r = n.type === "Me" || n.type === "Company" ? 5 : 4;
                const hot = pathNodes.has(n.id);
                const x = n.x ?? 0;
                const y = n.y ?? 0;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, 2 * Math.PI);
                ctx.fillStyle = NODE_COLORS[n.type] ?? "#5b6683";
                ctx.fill();
                if (hot) {
                  ctx.lineWidth = 2 / scale;
                  ctx.strokeStyle = "#10b981";
                  ctx.beginPath();
                  ctx.arc(x, y, r + 2.5, 0, 2 * Math.PI);
                  ctx.stroke();
                }
                // Labels: only the path and the anchors stay readable at every zoom; the rest fade in as you zoom.
                const major = hot || n.type === "Me" || n.type === "Company";
                if (!major && scale < 1.6) return;
                const fs = (major ? 10.5 : 9.5) / scale;
                ctx.font = `${hot ? "500 " : ""}${fs}px Inter, ui-sans-serif, system-ui, sans-serif`;
                ctx.textAlign = "center";
                const text = n.label.length > 20 ? n.label.slice(0, 19) + "…" : n.label;
                const tw = ctx.measureText(text).width;
                // Alternate label side by node type so neighbours don't stack on the same baseline.
                const above = n.type === "Me" || n.type === "Company" || n.type === "Competitor";
                ctx.textBaseline = above ? "bottom" : "top";
                const ty = above ? y - r - 2.5 : y + r + 2.5;
                // White pill behind the text so overlapping labels stay legible.
                const pad = 2 / scale;
                ctx.fillStyle = "rgba(255,255,255,0.92)";
                ctx.fillRect(x - tw / 2 - pad, above ? ty - fs - pad / 2 : ty - pad / 2, tw + pad * 2, fs + pad);
                ctx.fillStyle = hot ? "#047857" : "#1f2a44";
                ctx.fillText(text, x, ty);
              }}
              nodePointerAreaPaint={(n: GNode, color: string, ctx: CanvasRenderingContext2D) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(n.x ?? 0, n.y ?? 0, 7, 0, 2 * Math.PI);
                ctx.fill();
              }}
            />
          </div>
        )}
        <Legend />
        {warmPath && warmPath.hops.length > 0 && !loading && (
          <span className="wp-fade-in pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-sm border border-emerald-200 bg-panel/90 px-1.5 py-px text-[11px] font-medium tracking-wide text-emerald-300 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            Warm path · {warmPath.hops.length} hop{warmPath.hops.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-[12px]">
        <section>
          <h3 className="mb-1.5 font-serif text-[18px] text-neutral-900">Why this lead</h3>
          {loading ? (
            <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-100" />
          ) : warmPath && warmPath.hops.length ? (
            <p className="leading-relaxed text-neutral-800">{hopsToText(warmPath, graph)}</p>
          ) : (
            <p className="text-neutral-500">No warm path within 3 hops. Cold approach on the signal below.</p>
          )}
        </section>

        {warmPath?.cypher && (
          <section>
            <div className="mb-1 text-[11px] tracking-wide text-neutral-500">Cypher</div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-sm border border-neutral-200 bg-neutral-50 p-2 font-mono text-[11px] leading-snug text-neutral-800">
              {warmPath.cypher}
            </pre>
          </section>
        )}

        <section>
          <div className="mb-1 text-[11px] tracking-wide text-neutral-500">Top signal</div>
          {topSignal ? (
            <div className="space-y-2 rounded-sm border border-neutral-200 p-2">
              <div className="flex items-center gap-1.5">
                <SignalChip type={topSignal.type} />
                <span className="tabular-nums text-neutral-500">{fmtDate(topSignal.date)}</span>
              </div>
              <p className="text-neutral-900">{topSignal.summary}</p>
              <SourceList sources={[topSignal.source]} />
            </div>
          ) : (
            <p className="text-neutral-500">No signal on record.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function hopsToText(wp: WarmPath, graph: GraphData | null) {
  const label = (k: string) => graph?.nodes.find((n) => n.id === k)?.label ?? k;
  const meNode = graph?.nodes.find((n) => n.type === "Me");
  const name = (k: string) => (k === meNode?.id || /^me$/i.test(label(k)) ? "You" : label(k));
  const parts: string[] = [];
  let tail = wp.hops[0]?.from ?? "";
  parts.push(name(tail));
  // An edge pointing back toward the path reads as "X ← rel ← Y".
  wp.hops.forEach((h) => {
    if (h.from === tail || h.to !== tail) {
      parts.push(`→ ${h.rel} →`, name(h.to));
      tail = h.to;
    } else {
      parts.push(`← ${h.rel} ←`, name(h.from));
      tail = h.from;
    }
  });
  return parts.join(" ");
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-1.5 left-2 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-neutral-600">
      {(Object.keys(NODE_COLORS) as NodeType[]).map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: NODE_COLORS[t] }} />
          {t}
        </span>
      ))}
    </div>
  );
}
