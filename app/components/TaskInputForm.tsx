"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { API_BASE, type StoredTask } from "./taskTypes";

// ─────────────────────────────────────────────────────────────────────────────
// TaskInputForm — clean, minimal capture. On submit it POSTs to /task-analyze
// (fire-and-forget warm-up) and hands the new StoredTask up to the parent,
// which owns localStorage persistence. Shows a confirmation toast + clears.
// ─────────────────────────────────────────────────────────────────────────────

const ESTIMATE_OPTIONS: { label: string; minutes: number }[] = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hr", minutes: 60 },
  { label: "2 hr", minutes: 120 },
  { label: "3 hr+", minutes: 180 },
];

interface TaskInputFormProps {
  onAdd: (task: StoredTask) => void;
}

export function TaskInputForm({ onAdd }: TaskInputFormProps) {
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [estimate, setEstimate] = useState(60);
  const [context, setContext] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle("");
    setDeadline("");
    setEstimate(60);
    setContext("");
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !deadline) {
      showToast("⚠ Add a title and a deadline.");
      return;
    }

    // datetime-local gives "YYYY-MM-DDTHH:mm" (no seconds / tz) — append :00
    // so the backend's datetime.fromisoformat parses it as a naive local time.
    const deadline_iso =
      deadline.length === 16 ? `${deadline}:00` : deadline;

    const task: StoredTask = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: title.trim(),
      description: context.trim(),
      deadline_iso,
      estimated_minutes: estimate,
      context: context.trim(),
      created_at: new Date().toISOString(),
    };

    setSubmitting(true);
    // Warm the CVL engine immediately; the polling loop will fill in live data.
    try {
      await fetch(`${API_BASE}/task-analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: task.description,
          deadline_iso: task.deadline_iso,
          estimated_minutes: task.estimated_minutes,
          context: task.context,
        }),
      });
    } catch {
      /* network errors are non-fatal — the live loop retries */
    } finally {
      setSubmitting(false);
    }

    onAdd(task);
    reset();
    showToast("✓ Task added — Override is now monitoring it.");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6"
    >
      {/* Title */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What must get done?"
        className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-4 text-xl font-semibold text-white placeholder:text-white/30 outline-none focus:border-white/30"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Deadline */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Deadline
          </span>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-white/30 [color-scheme:dark]"
          />
        </label>

        {/* Estimated time */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Estimated time
          </span>
          <select
            value={estimate}
            onChange={(e) => setEstimate(Number(e.target.value))}
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-white/30 [color-scheme:dark]"
          >
            {ESTIMATE_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Context */}
      <input
        type="text"
        value={context}
        onChange={(e) => setContext(e.target.value)}
        placeholder="Add context: professor name, client, etc."
        className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
      />

      <Button
        type="submit"
        disabled={submitting}
        className="h-12 rounded-xl bg-white text-base font-bold text-black hover:bg-white/90 disabled:opacity-60"
      >
        {submitting ? "Analyzing…" : "Add task"}
      </Button>

      {toast && (
        <p className="ov-animate-rise rounded-lg border border-white/10 bg-black/60 px-4 py-2 text-center text-sm text-white">
          {toast}
        </p>
      )}
    </form>
  );
}
