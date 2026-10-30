"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonClass } from "@/components/ui/Button";
import { PreferenceCard, EnvCard, RewardCard } from "./StoryCards";
import { TrainingChart } from "./TrainingChart";
import { EvalPanel } from "./EvalPanel";

export function ModelBoard() {
  return (
    <div className="px-8 py-8">
      <div className="mb-6 flex items-end justify-between gap-6">
        <div>
        <h1 className="k-title">
          Every approval <span className="k-accent">trains</span> the model
        </h1>
        <p className="k-sub max-w-3xl">
          Every human approval trains the model. Approve / edit / reject in Outreach → preference pairs → an RL environment whose
          reward is the same verifier that gates the queue → GRPO.
        </p>
        </div>
        <Link href="/outreach" className={buttonClass("primary")}>
          Review drafts <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PreferenceCard />
        <EnvCard />
        <RewardCard />
      </div>

      <h2 className="mb-3 mt-10 text-[20px] font-semibold tracking-[-0.015em] text-neutral-950">Training</h2>
      <TrainingChart />

      <h2 className="mb-3 mt-10 text-[20px] font-semibold tracking-[-0.015em] text-neutral-950">Eval: base vs trained</h2>
      <EvalPanel />
    </div>
  );
}
