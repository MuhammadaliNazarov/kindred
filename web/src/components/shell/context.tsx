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

  const push = useCallback((step: ThinkingStep) => {
    if (seen.current.has(step.id)) return;
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
