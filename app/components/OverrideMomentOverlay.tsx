"use client";

import { useEffect, useRef, useState } from "react";
import { CountdownTimer } from "./CountdownTimer";
import { RescuePlanPanel } from "./RescuePlanPanel";
import { API_BASE, type AnalyzedTask, type RescuePlan } from "./taskTypes";

// ─────────────────────────────────────────────────────────────────────────────
// OverrideMomentOverlay — THE HERO. Full-viewport crimson takeover that slides
// up from the bottom. Fetches the rescue plan on mount and streams it in below
// the giant task title + live countdown.
// ─────────────────────────────────────────────────────────────────────────────

interface OverrideMomentOverlayProps {
  task: AnalyzedTask;
  onDismiss: () => void;
}

export function OverrideMomentOverlay({
  task,
  onDismiss,
}: OverrideMomentOverlayProps) {
  const [plan, setPlan] = useState<RescuePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchedFor = useRef<string | null>(null);

  const minutesRemaining = task.analysis?.minutes_remaining ?? 0;
  const keyRisk = task.analysis?.key_risk;

  useEffect(() => {
    // Guard against double-fetch (StrictMode) for the same task.
    if (fetchedFor.current === task.id) return;
    fetchedFor.current = task.id;

    let cancelled = false;
    setPlan(null);
    setError(null);

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/rescue-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: task.title,
            deadline_iso: task.deadline_iso,
            minutes_remaining: minutesRemaining,
            estimated_minutes: task.estimated_minutes,
            context: task.context,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: RescuePlan = await res.json();
        if (!cancelled) setPlan(data);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "unknown error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Allow Escape to dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      className="override-overlay-enter fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      style={{
        background: "linear-gradient(135deg, #1a0000, #3d0000, #1a0000)",
        backgroundSize: "400% 400%",
        animation:
          "slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards, gradient-shift 4s ease infinite",
      }}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-8">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-[0.35em] text-red-300">
            ⚡ Override Activated
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss override"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Center — giant title */}
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <h1 className="text-5xl font-black leading-tight text-white sm:text-6xl">
            {task.title}
          </h1>
          <CountdownTimer
            deadline_iso={task.deadline_iso}
            className="text-3xl text-white"
          />
          {keyRisk && (
            <p className="max-w-xl text-base italic text-red-200/80">
              {keyRisk}
            </p>
          )}
        </div>

        {/* Separator */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-red-400/40 to-transparent" />

        {/* Rescue plan */}
        <RescuePlanPanel plan={plan} error={error} />
      </div>
    </div>
  );
}
