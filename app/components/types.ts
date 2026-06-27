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

export type StageStatus = "default" | "active" | "complete";

export interface PipelineStage {
  id: StageId;
  label: string;
  sublabel: string;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "sensors", label: "Sensors", sublabel: "GPS · Motion · Audio · Battery" },
  { id: "fusion", label: "Fusion", sublabel: "Evidence synthesis" },
  { id: "risk", label: "Risk Engine", sublabel: "Rule-based triage" },
  { id: "gemini", label: "Gemini", sublabel: "Structured reasoning" },
  { id: "cvl", label: "CVL", sublabel: "Confidence validation" },
  { id: "action", label: "Action", sublabel: "Dashboard + dialer + location" },
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
