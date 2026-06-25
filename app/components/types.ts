// Shared types for the Override home page pipeline.

// Pipeline stage identifiers, in display order.
export type StageId =
  | "receiving"
  | "extraction"
  | "validation"
  | "confidence"
  | "ready";

export type StageStatus = "default" | "active" | "complete";

export interface PipelineStage {
  id: StageId;
  label: string;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "receiving", label: "Receiving Input" },
  { id: "extraction", label: "Gemini Extraction" },
  { id: "validation", label: "CVL Validation" },
  { id: "confidence", label: "Confidence Check" },
  { id: "ready", label: "Decision Ready" },
];

// Live info accumulated from SSE events while processing.
export interface LiveInfo {
  emergencyType?: string;
  confidence?: number; // 0..100 (percentage)
  followUpQuestion?: string;
  followUpLoop?: number;
}

// State carried between paused streams so the next /analyze call can resume
// exactly where the previous one stopped (see the backend `awaiting_follow_up`
// event). Without this, a live user is shown a clarification question but can
// never answer it, and the pipeline loops on the same question.
export interface ResumeState {
  resumeTranscript: string; // accumulated transcript from the paused stream
  pendingQuestion: string; // the question the user must answer
  loopsUsed: number; // how many clarification loops have already run
}
