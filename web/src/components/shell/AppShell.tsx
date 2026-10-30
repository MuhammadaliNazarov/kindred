"use client";

import { useState } from "react";
import { PanelRightOpen } from "lucide-react";
import { Nav } from "./Nav";
import { CreditsMeter } from "./CreditsMeter";
import { ThinkingPanel } from "./ThinkingPanel";
import { useThinking } from "./context";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const { steps } = useThinking();
  return (
    <div className="flex h-screen overflow-hidden">
      <Nav />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 overflow-hidden border-b border-neutral-200 px-5">
          <div className="shrink-0 whitespace-nowrap text-[12px] text-neutral-500">
            Selling <span className="font-medium text-neutral-900">Tenki</span>
            <span className="mx-1.5 text-neutral-300">/</span>
            <span className="hidden xl:inline">tenki.cloud</span>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <CreditsMeter />
            {!open && (
              <button
                onClick={() => setOpen(true)}
                className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-neutral-200 px-2 text-[12px] text-neutral-700 hover:bg-neutral-50"
              >
                <PanelRightOpen className="h-3.5 w-3.5" />
                Agent Thinking
                <span className="tabular-nums text-neutral-400">{steps.length}</span>
              </button>
            )}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      {open && <ThinkingPanel onClose={() => setOpen(false)} />}
    </div>
  );
}
