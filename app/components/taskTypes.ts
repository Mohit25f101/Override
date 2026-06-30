// ─────────────────────────────────────────────────────────────────────────────
// Shared types for the Override "Last-Minute Life Saver" task flow.
// These mirror the FastAPI Pydantic models in main.py (snake_case on the wire).
// ─────────────────────────────────────────────────────────────────────────────

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const TASKS_STORAGE_KEY = "override_tasks";

// A single user task as persisted in localStorage.
export interface StoredTask {
  id: string;
  title: string;
  description: string;
  deadline_iso: string;
  estimated_minutes: number;
  context: string;
  created_at: string;
}

// Response from POST /task-analyze.
export interface TaskAnalysis {
  urgency_score: number; // 0.0 .. 1.0
  urgency_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
  minutes_remaining: number;
  will_miss_deadline: boolean;
  key_risk: string;
  cvl_iterations: number;
}

// A task augmented with its latest live analysis (null until first fetch).
export interface AnalyzedTask extends StoredTask {
  analysis?: TaskAnalysis | null;
}

// One step from POST /rescue-plan.
export interface MicroStep {
  order: number;
  title: string;
  duration_minutes: number;
  action: string;
}

// Response from POST /rescue-plan.
export interface RescuePlan {
  micro_steps: MicroStep[];
  total_minutes: number;
  gemini_insight: string;
  email_subject?: string | null;
  email_body?: string | null;
  grounded_tip?: string | null;
}

// Map an urgency score to the canonical Override color (per spec).
export function urgencyColor(score: number): string {
  if (score < 0.4) return "#22c55e"; // green
  if (score < 0.6) return "#f59e0b"; // amber
  if (score < 0.75) return "#f97316"; // orange
  return "#ef4444"; // red
}

// Read tasks from localStorage (SSR-safe).
export function loadTasks(): AnalyzedTask[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TASKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AnalyzedTask[]) : [];
  } catch {
    return [];
  }
}

// Persist tasks to localStorage (SSR-safe). Analysis is stripped so we only
// store the durable task definition, not transient live scores.
export function saveTasks(tasks: AnalyzedTask[]): void {
  if (typeof window === "undefined") return;
  try {
    const durable: StoredTask[] = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      deadline_iso: t.deadline_iso,
      estimated_minutes: t.estimated_minutes,
      context: t.context,
      created_at: t.created_at,
    }));
    window.localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(durable));
  } catch {
    /* ignore quota / serialization errors */
  }
}
