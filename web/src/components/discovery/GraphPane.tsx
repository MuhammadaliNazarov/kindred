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
  Me: "#059669", // emerald-600
  Company: "#171717", // neutral-900
  Person: "#2563eb", // blue-600
  Competitor: "#e11d48", // rose-600
  Signal: "#f59e0b", // amber-500
  Product: "#7c3aed", // violet-600
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
  const [size, setSize] = useState({ w: 420, h: 300 });

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
      <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-neutral-500">
        Select an account or buyer to draw its graph and warm path.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-200 px-4 py-2.5">
        <div className="font-serif text-[15px] text-neutral-900">{person ? person.name : company.name}</div>
        <div className="text-[11px] text-neutral-500">
          {person ? `${person.title} · ${company.name}` : `${company.domain} · ${company.industry}`}
        </div>
      </div>

      <div ref={wrapRef} className="relative h-[300px] shrink-0 border-b border-neutral-200 bg-neutral-50/40">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Traversing warm paths…
          </div>
        ) : data.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-neutral-500">No graph for this lead yet.</div>
        ) : (
          <ForceGraph2D
            width={size.w}
            height={size.h}
            graphData={data}
            backgroundColor="rgba(0,0,0,0)"
            cooldownTicks={80}
            nodeRelSize={4}
            linkLabel={(l: GLink) => l.rel}
            nodeLabel={(n: GNode) => `${n.type}: ${n.label}`}
            linkColor={(l: GLink) => (onPath(l) ? "#059669" : "#d4d4d4")}
            linkWidth={(l: GLink) => (onPath(l) ? 2.5 : 1)}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={1}
            linkDirectionalParticles={(l: GLink) => (onPath(l) ? 2 : 0)}
            linkDirectionalParticleColor={() => "#059669"}
            nodeCanvasObject={(n: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
              const r = n.type === "Me" || n.type === "Company" ? 5 : 4;
              const hot = pathNodes.has(n.id);
              ctx.beginPath();
              ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
              ctx.fillStyle = NODE_COLORS[n.type] ?? "#737373";
              ctx.fill();
              if (hot) {
                ctx.lineWidth = 2 / scale;
                ctx.strokeStyle = "#059669";
                ctx.beginPath();
                ctx.arc(n.x ?? 0, n.y ?? 0, r + 2.5, 0, 2 * Math.PI);
                ctx.stroke();
              }
              const fs = 11 / scale;
              ctx.font = `${hot ? "600 " : ""}${fs}px sans-serif`;
              ctx.fillStyle = hot ? "#065f46" : "#404040";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillText(n.label, n.x ?? 0, (n.y ?? 0) + r + 2);
            }}
            nodePointerAreaPaint={(n: GNode, color: string, ctx: CanvasRenderingContext2D) => {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(n.x ?? 0, n.y ?? 0, 7, 0, 2 * Math.PI);
              ctx.fill();
            }}
          />
        )}
        <Legend />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-[12px]">
        <section>
          <h3 className="mb-1.5 font-serif text-[14px] text-neutral-900">Why this lead</h3>
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
            <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Cypher</div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-sm border border-neutral-200 bg-neutral-50 p-2 font-mono text-[11px] leading-snug text-neutral-800">
              {warmPath.cypher}
            </pre>
          </section>
        )}

        <section>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Top signal</div>
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
    <div className="pointer-events-none absolute bottom-1.5 left-2 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-neutral-600">
      {(Object.keys(NODE_COLORS) as NodeType[]).map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: NODE_COLORS[t] }} />
          {t}
        </span>
      ))}
    </div>
  );
}
