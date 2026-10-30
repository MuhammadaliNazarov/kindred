"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { PanelRightOpen } from "lucide-react";
import { Nav } from "./Nav";
import { CreditsMeter } from "./CreditsMeter";
import { ThinkingPanel } from "./ThinkingPanel";
import { useThinking } from "./context";

/**
 * Shell: navy sidebar flush left, the light canvas laid on it as one rounded sheet.
 * The glass header is sticky inside the scrolling <main> so content passes under it.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const dense = pathname.startsWith("/outreach") || pathname.startsWith("/pipeline");
  // Dense boards (outreach, pipeline) need the width, so the panel defaults to collapsed there.
  // A manual toggle is remembered for the page it was made on.
  const [override, setOverride] = useState<{ path: string; open: boolean } | null>(null);
  const open = override?.path === pathname ? override.open : false; void dense;
  const setOpen = (v: boolean) => setOverride({ path: pathname, open: v });
  const { steps } = useThinking();
  return (
    <div className="shell-navy flex h-screen overflow-hidden">
      <Nav />
      <div className="my-2 mr-2 flex min-w-0 flex-1 overflow-hidden rounded-[18px] bg-[var(--bg-0)] text-neutral-900 ring-1 ring-black/5">
        <main className="relative min-w-0 flex-1 overflow-y-auto">
          <header className="glass-bar sticky top-0 z-20 flex h-14 items-center gap-3 px-8">
            <div className="ml-auto flex min-w-0 items-center gap-2">
              <CreditsMeter />
              {!open && (
                <button
                  onClick={() => setOpen(true)}
                  className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] text-neutral-600 hover:bg-black/[0.04] hover:text-neutral-950"
                >
                  <PanelRightOpen className="h-3.5 w-3.5" />
                  Agent Thinking
                  <span className="font-mono tabular-nums text-neutral-400">{steps.length}</span>
                </button>
              )}
            </div>
          </header>
          <div key={pathname} className="wp-page">
            {children}
          </div>
        </main>
        {open && <ThinkingPanel onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
}
