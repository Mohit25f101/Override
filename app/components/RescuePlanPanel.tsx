"use client";

import { MicroStepList } from "./MicroStepList";
import { EmailDraftSection } from "./EmailDraftSection";
import type { RescuePlan } from "./taskTypes";

// ─────────────────────────────────────────────────────────────────────────────
// RescuePlanPanel — the body of THE OVERRIDE MOMENT.
//   Loading (plan === null): shimmer skeleton.
//   Loaded: insight → micro-steps → grounded tip → email draft.
// ─────────────────────────────────────────────────────────────────────────────

interface RescuePlanPanelProps {
  plan: RescuePlan | null;
  error?: string | null;
}

function SkeletonLine({ w }: { w: string }) {
  return (
    <div
      className="ov-shimmer h-4 rounded-md bg-white/10"
      style={{ width: w }}
    />
  );
}

export function RescuePlanPanel({ plan, error }: RescuePlanPanelProps) {
  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-5 text-sm text-red-200">
        Could not reach the Rescue Engine: {error}. Start by doing the single
        most important thing right now — momentum beats perfection.
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <SkeletonLine w="70%" />
          <SkeletonLine w="90%" />
        </div>
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <SkeletonLine w="55%" />
              <SkeletonLine w="80%" />
            </div>
          ))}
        </div>
        <p className="text-center text-xs uppercase tracking-widest text-white/40">
          Gemini is building your rescue plan…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Gemini insight */}
      {plan.gemini_insight && (
        <blockquote className="border-l-2 border-amber-400 pl-4">
          <p className="text-xl font-medium italic leading-relaxed text-amber-200">
            “{plan.gemini_insight}”
          </p>
        </blockquote>
      )}

      {/* 2. Micro steps */}
      <MicroStepList steps={plan.micro_steps} />

      {/* 3. Grounded tip */}
      {plan.grounded_tip && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-gray-300">
          💡 <span className="font-semibold">Pro tip:</span> {plan.grounded_tip}
        </div>
      )}

      {/* 4. Email draft */}
      {plan.email_subject && plan.email_body && (
        <EmailDraftSection
          subject={plan.email_subject}
          body={plan.email_body}
        />
      )}
    </div>
  );
}
