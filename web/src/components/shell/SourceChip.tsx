"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { Link2 } from "lucide-react";
import type { Source } from "@/lib/types";

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A small citation chip. Hover shows quote, URL and a sample/verified badge. */
export function SourceChip({ source, index }: { source: Source; index?: number }) {
  return (
    <Tooltip.Provider delayDuration={120}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className={clsx(
              "inline-flex max-w-[180px] items-center gap-1 rounded border px-1.5 py-px text-[11px] leading-4",
              source.verified
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-neutral-200 bg-neutral-50 text-neutral-600 hover:border-neutral-300",
            )}
          >
            <Link2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{index !== undefined ? `[${index + 1}] ` : ""}{host(source.url)}</span>
          </a>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content sideOffset={6} className="z-50 w-72 rounded-md border border-neutral-200 bg-white p-3 text-[12px] shadow-sm">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="truncate font-medium">{source.title}</span>
              <span
                className={clsx(
                  "shrink-0 rounded border px-1 text-[10px] uppercase tracking-wide",
                  source.verified ? "border-emerald-300 text-emerald-700" : "border-neutral-300 text-neutral-500",
                )}
              >
                {source.verified ? "verified" : "sample"}
              </span>
            </div>
            <blockquote className="mb-1.5 border-l-2 border-neutral-300 pl-2 font-serif text-[13px] italic leading-snug text-neutral-800">
              “{source.quote}”
            </blockquote>
            <div className="truncate font-mono text-[10.5px] text-neutral-500">{source.url}</div>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export function SourceChips({ sources }: { sources?: Source[] }) {
  if (!sources?.length) return <span className="text-[11px] text-rose-600">no source</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {sources.map((s, i) => (
        <SourceChip key={s.url + i} source={s} index={i} />
      ))}
    </span>
  );
}
