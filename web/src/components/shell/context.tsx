"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Credits, ThinkingStep } from "@/lib/types";
import { getCredits, streamThinking } from "@/lib/api";

type ThinkingCtx = { steps: ThinkingStep[]; push: (step: ThinkingStep) => void };
type CreditsCtx = { credits: Credits | null; refresh: () => Promise<void> };

const ThinkingContext = createContext<ThinkingCtx>({ steps: [], push: () => {} });
const CreditsContext = createContext<CreditsCtx>({ credits: null, refresh: async () => {} });

export function useThinking() {
  return useContext(ThinkingContext);
}
export function useCredits() {
  return useContext(CreditsContext);
}

const MAX_STEPS = 200;

export function Providers({ children }: { children: React.ReactNode }) {
  const [steps, setSteps] = useState<ThinkingStep[]>([]);
  const [credits, setCredits] = useState<Credits | null>(null);
  const seen = useRef(new Set<string>());
  // Content fingerprint → last time we accepted it. Catches SSE replays and StrictMode double-streams
  // that arrive with fresh ids but the same agent + text.
  const recent = useRef(new Map<string, number>());

  const push = useCallback((step: ThinkingStep) => {
    if (seen.current.has(step.id)) return;
    const fp = `${step.agent}|${step.kind}|${step.text}`;
    const now = Date.now();
    const last = recent.current.get(fp);
    if (last !== undefined && now - last < 8000) return;
    recent.current.set(fp, now);
    seen.current.add(step.id);
    setSteps((prev) => [step, ...prev].slice(0, MAX_STEPS)); // newest first
  }, []);

  const refresh = useCallback(async () => {
    setCredits(await getCredits());
  }, []);

  useEffect(() => {
    const stop = streamThinking(push);
    return stop;
  }, [push]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <CreditsContext.Provider value={{ credits, refresh }}>
      <ThinkingContext.Provider value={{ steps, push }}>{children}</ThinkingContext.Provider>
    </CreditsContext.Provider>
  );
}
