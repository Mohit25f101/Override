"use client";

import { useState } from "react";
import type { MicroStep } from "./taskTypes";

// ─────────────────────────────────────────────────────────────────────────────
// MicroStepList — interactive checklist of the rescue plan's timed steps.
//   Done steps: strikethrough + green check.
//   All done:   celebration state ("DEADLINE BEATEN 🎯").
// ─────────────────────────────────────────────────────────────────────────────

interface MicroStepListProps {
  steps: MicroStep[];
}

export function MicroStepList({ steps }: MicroStepListProps) {
  const [done, setDone] = useState<Record<number, boolean>>({});

  const sorted = [...steps].sort((a, b) => a.order - b.order);
  const allDone =
    sorted.length > 0 && sorted.every((s) => done[s.order]);

  const toggle = (order: number) =>
    setDone((prev) => ({ ...prev, [order]: !prev[order] }));

  if (sorted.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5">
      {sorted.map((step) => {
        const isDone = !!done[step.order];
        return (
          <button
            key={step.order}
            type="button"
            onClick={() => toggle(step.order)}
            className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
              isDone
                ? "border-green-500/40 bg-green-500/5"
                : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
            }`}
          >
            {/* Checkbox */}
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${
                isDone
                  ? "border-green-500 bg-green-500 text-black"
                  : "border-white/30 text-transparent"
              }`}
              aria-hidden
            >
              ✓
            </span>

            <span className="flex flex-1 flex-col">
              <span
                className={`text-sm font-semibold ${
                  isDone
                    ? "text-gray-500 line-through"
                    : "text-white"
                }`}
              >
                Step {step.order}: {step.title}
                <span className="ml-2 font-normal text-amber-300/90">
                  — {step.duration_minutes} min
                </span>
              </span>
              <span
                className={`mt-0.5 text-xs ${
                  isDone ? "text-gray-600 line-through" : "text-gray-400"
                }`}
              >
                {step.action}
              </span>
            </span>
          </button>
        );
      })}

      {allDone && (
        <div className="ov-animate-rise mt-2 rounded-xl border border-green-500/50 bg-green-500/10 px-4 py-4 text-center">
          <p className="text-xl font-black tracking-wide text-green-300">
            DEADLINE BEATEN 🎯
          </p>
          <p className="mt-1 text-xs text-green-200/70">
            Every step complete. Override out.
          </p>
        </div>
      )}
    </div>
  );
}
