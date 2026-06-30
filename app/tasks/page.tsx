"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { TaskInputForm } from "../components/TaskInputForm";
import { TaskCard } from "../components/TaskCard";
import { OverrideMomentOverlay } from "../components/OverrideMomentOverlay";
import {
  API_BASE,
  loadTasks,
  saveTasks,
  type AnalyzedTask,
  type StoredTask,
  type TaskAnalysis,
} from "../components/taskTypes";

// ─────────────────────────────────────────────────────────────────────────────
// /tasks — the new main page. Three auto-transitioning visual states:
//   CALM        — no tasks, or all low urgency  (near-black)
//   MONITORING  — any task MEDIUM/HIGH           (warm amber tint)
//   OVERRIDE    — any task CRITICAL (>= 0.75)     (crimson takeover overlay)
// ─────────────────────────────────────────────────────────────────────────────

const CRITICAL_THRESHOLD = 0.75;

type Mode = "calm" | "monitoring";

export default function TasksPage() {
  // Initialise from localStorage on mount (SSR-safe via the lazy initializer).
  const [tasks, setTasks] = useState<AnalyzedTask[]>(() => loadTasks());

  const [overrideActive, setOverrideActive] = useState(false);
  const [overrideTask, setOverrideTask] = useState<AnalyzedTask | null>(null);
  // Tasks the user has explicitly dismissed — don't auto-reopen them.
  const dismissedRef = useRef<Set<string>>(new Set());

  // Keep localStorage in sync with the durable task definitions.
  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  // ── Live urgency loop ──────────────────────────────────────────────────────
  useEffect(() => {
    if (tasks.length === 0) return;

    let stopped = false;

    const pollUrgency = async () => {
      const current = loadTasks(); // durable defs; analysis re-merged below
      const updated = await Promise.all(
        current.map(async (task) => {
          try {
            const res = await fetch(`${API_BASE}/task-analyze`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: task.title,
                description: task.description || "",
                deadline_iso: task.deadline_iso,
                estimated_minutes: task.estimated_minutes,
                context: task.context,
              }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const analysis: TaskAnalysis = await res.json();
            return { ...task, analysis };
          } catch {
            return task; // keep previous state on error
          }
        })
      );

      if (stopped) return;

      // Merge fresh analysis onto the live state (preserve any prior analysis
      // for tasks whose fetch failed this round).
      setTasks((prev) =>
        updated.map((u) => {
          const existing = prev.find((p) => p.id === u.id);
          return { ...u, analysis: u.analysis ?? existing?.analysis ?? null };
        })
      );

      // Trigger THE OVERRIDE MOMENT for the first non-dismissed CRITICAL task.
      const critical = updated.find(
        (t) =>
          (t.analysis?.urgency_score ?? 0) >= CRITICAL_THRESHOLD &&
          !dismissedRef.current.has(t.id)
      );
      if (critical && !overrideActive) {
        setOverrideTask(critical);
        setOverrideActive(true);
      }
    };

    void pollUrgency(); // immediate first run
    const interval = setInterval(() => void pollUrgency(), 60000); // every 60s
    return () => {
      stopped = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length]);

  // ── Derived visual mode ─────────────────────────────────────────────────────
  const maxScore = useMemo(
    () =>
      tasks.reduce(
        (m, t) => Math.max(m, t.analysis?.urgency_score ?? 0),
        0
      ),
    [tasks]
  );
  const mode: Mode = maxScore >= 0.4 ? "monitoring" : "calm";

  // ── Handlers ────────────────────────────────────────────────────────────────
  const addTask = (task: StoredTask) => {
    setTasks((prev) => [...prev, { ...task, analysis: null }]);
  };

  const deleteTask = (id: string) => {
    dismissedRef.current.delete(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (overrideTask?.id === id) {
      setOverrideActive(false);
      setOverrideTask(null);
    }
  };

  const openOverride = (task: AnalyzedTask) => {
    dismissedRef.current.delete(task.id);
    setOverrideTask(task);
    setOverrideActive(true);
  };

  const dismissOverride = () => {
    if (overrideTask) dismissedRef.current.add(overrideTask.id);
    setOverrideActive(false);
    setOverrideTask(null);
  };

  // Keep the live overlay's task object fresh (countdown / minutes_remaining)
  // by re-reading from the tasks array.
  const liveOverrideTask = overrideTask
    ? tasks.find((t) => t.id === overrideTask.id) ?? overrideTask
    : null;

  // Background tint per mode.
  const bgStyle =
    mode === "monitoring"
      ? {
          background:
            "radial-gradient(circle at 50% -10%, rgba(245,158,11,0.10), transparent 55%), #0a0a0a",
        }
      : { background: "#0a0a0a" };

  return (
    <main
      className="min-h-screen w-full text-white transition-[background] duration-700"
      style={bgStyle}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
        {/* Header / nav */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-widest">OVERRIDE</h1>
            <p className="text-sm text-gray-400">
              Deadline crisis companion
            </p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/"
              className="text-gray-400 transition-colors hover:text-white"
            >
              Sensors
            </Link>
            <Link
              href="/dashboard"
              className="text-gray-400 transition-colors hover:text-white"
            >
              Dashboard
            </Link>
          </nav>
        </header>

        {/* Mode indicator */}
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              mode === "monitoring"
                ? "bg-amber-400 ov-danger-pulse"
                : "bg-green-500"
            }`}
          />
          <span className="text-gray-400">
            {mode === "monitoring"
              ? "Monitoring — deadlines active"
              : "Calm — no active crisis"}
          </span>
        </div>

        {/* Input */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Add a deadline
          </h2>
          <TaskInputForm onAdd={addTask} />
        </section>

        {/* Task list */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Monitored tasks{tasks.length > 0 ? ` (${tasks.length})` : ""}
          </h2>

          {tasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-gray-500">
              No tasks yet. Add a deadline above and Override will start
              monitoring its breach probability every 60 seconds.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onDelete={deleteTask}
                  onOverride={openOverride}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* THE OVERRIDE MOMENT */}
      {overrideActive && liveOverrideTask && (
        <OverrideMomentOverlay
          task={liveOverrideTask}
          onDismiss={dismissOverride}
        />
      )}
    </main>
  );
}
