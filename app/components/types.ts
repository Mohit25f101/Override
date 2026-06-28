// Shared types for the Override sensor-first pipeline.

// ───────────────────────────────────────────────────────────────────────────
// Pipeline stages (6-stage flow: Sensors → Fusion → Risk → Gemini → CVL → Action)
// ───────────────────────────────────────────────────────────────────────────

export type StageId =
  | "sensors"
  | "fusion"
  | "risk"
  | "gemini"
  | "cvl"
  | "action";

// Stage status. "thinking" is a NON-BLOCKING state: a stage can be marked
// "thinking" (e.g. Gemini enriching in the background) while later stages have
// already advanced — this is the visual signature of the event-driven pipeline.
export type StageStatus = "default" | "active" | "thinking" | "complete";

export interface PipelineStage {
  id: StageId;
  // User-facing, action-oriented label (point 5 of the spec). The old technical
  // names are kept in `tech` purely for transparency / the "About" view.
  label: string;
  sublabel: string;
  tech: string;
  icon: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Action-oriented terminology (point 5 of the spec):
//   Collecting Evidence  (was Sensors / Fusion)
//   Estimating Risk      (was Risk Engine)
//   Analyzing Situation  (was Gemini)
//   Verifying Decision   (was CVL)
//   Preparing Response   (was Action)
//
// We collapse Sensors + Fusion into one user-facing "Collecting Evidence" step
// so the visible pipeline reads as five clean, human stages.
// ───────────────────────────────────────────────────────────────────────────
export const PIPELINE_STAGES: PipelineStage[] = [
  {
    id: "fusion",
    label: "Collecting Evidence",
    sublabel: "GPS · Motion · Audio · Battery",
    tech: "Sensors + Fusion",
    icon: "📡",
  },
  {
    id: "risk",
    label: "Estimating Risk",
    sublabel: "Instant deterministic triage",
    tech: "Risk Engine",
    icon: "⚡",
  },
  {
    id: "gemini",
    label: "Analyzing Situation",
    sublabel: "Background AI enrichment",
    tech: "Gemini",
    icon: "🧠",
  },
  {
    id: "cvl",
    label: "Verifying Decision",
    sublabel: "Confidence validation",
    tech: "CVL",
    icon: "🛡️",
  },
  {
    id: "action",
    label: "Preparing Response",
    sublabel: "Dialer · CPR · Location",
    tech: "Action",
    icon: "🚑",
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Sensor model — what the browser can actually read, and demo/unavailable flags.
// ───────────────────────────────────────────────────────────────────────────

// Availability of an individual sensor.
//   "live"        — real reading from a hardware sensor
//   "demo"        — simulated value (must always render an orange DEMO badge)
//   "unavailable" — not supported in this browser/context (gray badge)
export type SensorAvailability = "live" | "demo" | "unavailable";

export type SensorKey = "gps" | "motion" | "audio" | "battery";

export interface SensorReading {
  key: SensorKey;
  label: string;
  icon: string; // emoji for compact UI
  availability: SensorAvailability;
  // Human-readable current value, e.g. "0 km/h", "78 RMS", "4.2 g", "—".
  value: string;
}

// Raw sensor readings collected by the useSensors hook. Nulls mean "no data".
export interface RawSensors {
  // GPS
  gpsAvailable: boolean;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number | null;
  // Motion
  motionAvailable: boolean;
  accelMagnitudeG: number | null; // peak acceleration magnitude in g
  // Audio
  audioAvailable: boolean;
  audioLevel: number | null; // 0..100 RMS
  // Battery
  batteryAvailable: boolean;
  batteryLevel: number | null; // 0..1
  // Which keys are simulated (demo) rather than live.
  demoKeys: SensorKey[];
}

// ───────────────────────────────────────────────────────────────────────────
// Sensor Fusion output (mirrors the backend EvidenceObject).
// ───────────────────────────────────────────────────────────────────────────

export interface EvidenceObject {
  motionAnomaly: boolean | null; // true if acceleration spike detected
  locationAvailable: boolean;
  speedKmh: number | null; // from GPS, null if unavailable
  audioLevel: number | null; // 0–100 RMS, null if mic unavailable
  batteryLow: boolean | null; // true if battery < 15%
  deviceStationary: boolean | null; // true if no motion for > 30 s
  timestamp: number;
  sourcesUsed: string[]; // list of real sensors that contributed
  demoSources: string[]; // list of simulated sensors
}

// ───────────────────────────────────────────────────────────────────────────
// Risk Engine output.
// ───────────────────────────────────────────────────────────────────────────

export type RiskLevel = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";

export interface RiskAssessment {
  riskLevel: RiskLevel;
  emergencyType: string;
  confidence: number; // 0–1
  missingEvidence: string[];
  rulesFired: string[];

  // ── Progressive-confidence additions (point 4 of the spec) ────────────────
  // Action-oriented headline shown the instant an emergency is flagged, BEFORE
  // any AI call (e.g. "⚠ Possible Collision Detected").
  headline?: string;
  // Ordered list of (value, reason) jumps that built up the confidence score,
  // so the UI can narrate a live, continuously-climbing percentage.
  signals?: ConfidencePoint[];
}

// ───────────────────────────────────────────────────────────────────────────
// Live info accumulated from SSE events while processing.
// ───────────────────────────────────────────────────────────────────────────

export interface LiveInfo {
  emergencyType?: string;
  confidence?: number; // 0..100 (percentage)
  band?: string; // PROCEED | ASK_ONE | UNCERTAIN
  followUpQuestion?: string;
  followUpLoop?: number;
  riskLevel?: RiskLevel;
  sensors?: SensorReading[];

  // ── Event-driven, non-blocking additions ──────────────────────────────────
  // Human-readable headline shown the instant the Risk Engine flags an
  // emergency — BEFORE Gemini is ever called (e.g. "⚠ Possible Collision").
  headline?: string;
  // True once the deterministic Risk Engine has flagged an emergency. Drives the
  // app's transition into the polished "emergency mode" theme.
  emergencyMode?: boolean;
  // True while Gemini is enriching in the background. The pipeline keeps moving;
  // this only powers a subtle "Analyzing…" shimmer, never a blocking spinner.
  aiThinking?: boolean;
  // One-line AI enrichment summary, streamed in asynchronously once Gemini
  // returns. Purely additive — it never gates the alert.
  aiSummary?: string;
  // Where the latest confidence figure came from, so the UI can narrate the
  // progressive climb ("Device stationary 10s → 72%").
  confidenceSource?: string;
  // True when the system auto-advanced because the user did not respond in time
  // (silence/stillness → assume the worst).
  autoAdvanced?: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// A single point on the progressive-confidence timeline. The Risk Engine and
// SSE stream both emit these so the UI can animate a continuously climbing
// score with a human-readable reason for each jump (point 4 of the spec).
// ───────────────────────────────────────────────────────────────────────────
export interface ConfidencePoint {
  // 0..100 percentage at this moment.
  value: number;
  // Why the score moved, e.g. "Device stationary for 10s".
  reason: string;
  // Epoch ms when this point was recorded.
  at: number;
}

// State carried between paused streams so the next request can resume exactly
// where the previous one stopped (see backend `awaiting_follow_up` event).
export interface ResumeState {
  resumeTranscript: string;
  pendingQuestion: string;
  loopsUsed: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Technical-honesty feature labels. Displayed verbatim in the "About sensors"
// modal so a judge can see exactly what is real vs. demo vs. future work.
// ───────────────────────────────────────────────────────────────────────────

export const FEATURE_STATUS = {
  GPS_LIVE: "Implemented",
  MOTION_LIVE: "Implemented",
  AUDIO_LEVEL: "Implemented",
  BATTERY: "Partially Implemented",
  AUDIO_RECOGNITION: "Demo Mode",
  CRASH_DETECTION: "Future Work",
  GLASS_BREAK: "Future Work",
  AUTO_CALL: "Future Work",
} as const;

// Human-readable rows for the About-sensors modal.
export const FEATURE_STATUS_ROWS: { label: string; status: string }[] = [
  { label: "GPS location (live)", status: FEATURE_STATUS.GPS_LIVE },
  { label: "Accelerometer / motion (live)", status: FEATURE_STATUS.MOTION_LIVE },
  { label: "Microphone audio level", status: FEATURE_STATUS.AUDIO_LEVEL },
  { label: "Battery level", status: FEATURE_STATUS.BATTERY },
  { label: "Audio recognition (glass/scream)", status: FEATURE_STATUS.AUDIO_RECOGNITION },
  { label: "Vehicle crash detection", status: FEATURE_STATUS.CRASH_DETECTION },
  { label: "Glass-break recognition", status: FEATURE_STATUS.GLASS_BREAK },
  { label: "Automatic emergency calls", status: FEATURE_STATUS.AUTO_CALL },
];

// ───────────────────────────────────────────────────────────────────────────
// OVERRIDE V2: Immutable Contexts & Architecture Types
// ───────────────────────────────────────────────────────────────────────────

export type EmergencyState = 
  | "Monitoring"
  | "Suspicious Activity"
  | "Possible Emergency"
  | "Emergency Confirmed"
  | "Response Active"
  | "Resolved";

export interface EvidenceItem {
  id: string;
  type: string;
  source: string;
  confidence: number; // 0..1
  timestamp: number;
  details: Record<string, unknown>;
}

export interface ActionDef {
  priority: number; // 1 (highest) to 3
  type: "CALL" | "LOCATION" | "CPR" | "MONITOR";
  label: string;
  reason: string[];
  blocking: boolean;
  automatic: boolean;
  requiresConfirmation: boolean;
}

export interface IncidentContext {
  incidentId: string;
  type: string; // e.g. "vehicle_collision", "unknown"
  startTime: number;
  evidence: EvidenceItem[];
  severity: RiskLevel;
  confidence: number;
  confidenceBand: "Monitoring" | "Suspicious" | "Possible" | "Confirmed";
}

// Structured Timeline Event
export interface TimelineEvent {
  time: number;
  module: string;
  type: string;
  payload: Record<string, unknown>;
}
