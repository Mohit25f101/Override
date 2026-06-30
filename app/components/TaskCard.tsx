"use client";

import { UrgencyGauge } from "./UrgencyGauge";
import { CountdownTimer } from "./CountdownTimer";
import type { AnalyzedTask } from "./taskTypes";

// ─────────────────────────────────────────────────────────────────────────────
// TaskCard — one monitored task.
//   Left:  title + deadline + live countdown + context badge
//   Right: small UrgencyGauge (80px)
//   Bottom: key_risk (italic) when HIGH/CRITICAL
//   CRITICAL: pulsing red border (task-card-critical)
// ─────────────────────────────────────────────────────────────────────────────

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface TaskCardProps {
  task: AnalyzedTask;
  onDelete?: (id: string) => void;
  onOverride?: (task: AnalyzedTask) => void;
}

export function TaskCard({ task, onDelete, onOverride }: TaskCardProps) {
  const analysis = task.analysis ?? null;
  const score = analysis?.urgency_score ?? 0;
  const level = analysis?.urgency_level ?? "…";
  const isHigh = level === "HIGH" || level === "CRITICAL";
  const isCritical = level === "CRITICAL" || score >= 0.75;

  return (
    <div
      className={`ov-animate-rise relative flex flex-col gap-3 rounded-2xl border bg-white/[0.03] p-5 transition-colors ${
        isCritical
          ? "task-card-critical border-red-500/40"
          : isHigh
          ? "border-amber-400/30"
          : "border-white/10"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h3 className="truncate text-lg font-bold text-white">
            {task.title}
          </h3>
          <p className="text-sm text-gray-400">
            Due {formatDeadline(task.deadline_iso)}
          </p>
          <CountdownTimer
            deadline_iso={task.deadline_iso}
            className="text-sm text-gray-300"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {task.context && (
              <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs text-gray-300">
                {task.context}
              </span>
            )}
            <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs text-gray-400">
              ~{task.estimated_minutes} min
            </span>
          </div>
        </div>

        {/* Right — gauge */}
        <div className="shrink-0">
          {analysis ? (
            <UrgencyGauge score={score} level={level} size={80} />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/10">
              <span className="ov-shimmer h-2 w-10 rounded-full bg-white/10" />
            </div>
          )}
        </div>
      </div>

      {/* Bottom — key risk */}
      {analysis && isHigh && analysis.key_risk && (
        <p className="text-sm italic text-red-200/90">⚠ {analysis.key_risk}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        {isCritical && onOverride && (
          <button
            type="button"
            onClick={() => onOverride(task)}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
          >
            ⚡ Open Override
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(task.id)}
            className="text-xs text-gray-500 transition-colors hover:text-gray-300"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
