"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Pipeline } from "./components/Pipeline";
import { SensorGrid, DemoBadge } from "./components/SensorGrid";
import { LiveInfoCard } from "./components/LiveInfoCard";
import { EmergencyLifecycle } from "./components/EmergencyLifecycle";
import { useSensors } from "./hooks/useSensors";
import { fuseSensors, evidenceToBackend } from "./lib/sensorFusion";
import { assessRisk, riskToBackend, escalateOnSilence } from "./lib/riskEngine";
import { analyzeEvidence } from "./lib/evidenceEngine";
import { buildIncident } from "./lib/incidentBuilder";
import type {
  EvidenceObject,
  LiveInfo,
  ResumeState,
  RiskAssessment,
  RawSensors,
  IncidentContext,
} from "./components/types";

// ─────────────────────────────────────────────────────────────────────────────
// Backend configuration. No hardcoded keys anywhere — the base URL is supplied
// at build time via NEXT_PUBLIC_API_URL and falls back to localhost for dev.
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SENSOR_ANALYZE_URL = `${API_BASE}/sensor-analyze`;
const ANALYZE_URL = `${API_BASE}/analyze`;

// How often the live sensor loop re-fuses + re-assesses (ms).
const SENSOR_LOOP_MS = 500;
// Settle time after a demo spike before we POST the evidence (ms).
// Increased to 2500ms to allow the user to see the evidence building up before AI takes over.
const DEMO_SETTLE_MS = 2500;

// ─────────────────────────────────────────────────────────────────────────────
// Stage → activeIndex mapping (point 7 of the spec).
// PIPELINE_STAGES order: sensors=0, fusion=1, risk=2, gemini=3, cvl=4, action=5.
// ─────────────────────────────────────────────────────────────────────────────
function stageIndexForEvent(stage: string): number | null {
  switch (stage) {
    case "received":
      return 1; // fusion — we're building evidence
    case "risk_flagged":
      return 2; // risk
    case "extracting":
    case "extracted":
    case "reextracting":
    case "ai_timeout":
      return 3; // gemini
    case "validating":
    case "revalidating":
    case "follow_up":
    case "awaiting_follow_up":
      return 4; // cvl
    case "decision":
      return 5; // action
    case "complete":
      return 5; // action (+ allComplete handled separately)
    default:
      return null;
  }
}

// The wire body POSTed to /sensor-analyze. evidence + risk are nested snake_case
// objects (matching the backend Pydantic models); resume fields are top-level.
interface SensorAnalyzeBody {
  evidence: Record<string, unknown>;
  risk: Record<string, unknown> | null;
  text: string;
  follow_up_responses: string[];
  resume_transcript?: string;
  pending_question?: string;
  loops_used?: number;
}

type DemoPhase = "idle" | "running" | "awaiting_follow_up" | "complete";

export default function HomePage() {
  const router = useRouter();
  const {
    raw,
    readings,
    requestPermissions,
    applyDemoSpike,
  } = useSensors();

  // Sensor permission / loop state.
  const [permissionsGranted, setPermissionsGranted] = useState(false);

  // Pipeline visual state.
  const [activeIndex, setActiveIndex] = useState(0);
  const [allComplete, setAllComplete] = useState(false);
  const [liveInfo, setLiveInfo] = useState<LiveInfo>({});
  const [error, setError] = useState<string | null>(null);

  // Demo flow state.
  const [demoPhase, setDemoPhase] = useState<DemoPhase>("idle");

  // Follow-up (inline question) state.
  const [resumeState, setResumeState] = useState<ResumeState | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [submittingAnswer, setSubmittingAnswer] = useState(false);

  // Secondary text-flow state (de-emphasised).
  const [callerText, setCallerText] = useState("");
  const [textSubmitting, setTextSubmitting] = useState(false);

  // Latest fused evidence + risk, kept in refs so async handlers always read
  // the freshest values (state closures would be stale inside the SSE loop).
  const evidenceRef = useRef<EvidenceObject | null>(null);
  const incidentRef = useRef<IncidentContext | null>(null);
  const riskRef = useRef<RiskAssessment | null>(null);
  // Guard so we don't kick off two demo runs at once.
  const demoStartedRef = useRef(false);

  // ── Live sensor loop ───────────────────────────────────────────────────────
  const rawHistoryRef = useRef<RawSensors[]>([]);

  // Every 500 ms: fuse raw → EvidenceObject, assess → RiskAssessment. We always
  // recompute from `raw` so a demo spike injected into the hook flows through.
  useEffect(() => {
    if (!permissionsGranted) return;

    const tick = () => {
      rawHistoryRef.current.push(raw);
      if (rawHistoryRef.current.length > 10) rawHistoryRef.current.shift();

      const evidence = fuseSensors(raw); // Keep for backend compatibility
      const items = analyzeEvidence(rawHistoryRef.current);
      const incident = buildIncident(items, incidentRef.current);
      
      let risk = riskRef.current;
      if (incident) {
        risk = assessRisk(incident, "");
      }
      
      evidenceRef.current = evidence;
      incidentRef.current = incident;
      riskRef.current = risk;
      // Surface the live risk level onto the LiveInfoCard while idle.
      if (risk) setLiveInfo((prev) => ({ ...prev, riskLevel: risk!.riskLevel }));
    };

    tick(); // run immediately so the first frame has data
    const id = setInterval(tick, SENSOR_LOOP_MS);
    return () => clearInterval(id);
  }, [permissionsGranted, raw]);



  // ── Enable sensors ───────────────────────────────────────────────────────
  const handleEnableSensors = useCallback(async () => {
    setError(null);
    try {
      await requestPermissions();
    } catch {
      // Permission failures are non-fatal — some sensors may still report live.
    }
    setPermissionsGranted(true);
  }, [requestPermissions]);

  // ── Apply a single parsed SSE payload to UI state ───────────────────────────
  // Returns true when the stream has paused on a follow-up (so the caller stops
  // reading) — though in practice the backend ends the stream after that event.
  const applyEvent = useCallback(
    (payload: Record<string, unknown>) => {
      const stage = String(payload.stage ?? "");

      const idx = stageIndexForEvent(stage);
      if (idx !== null) setActiveIndex(idx);

      if (stage === "risk_flagged") {
        setLiveInfo((prev) => ({
          ...prev,
          headline: typeof payload.headline === "string" ? payload.headline : prev.headline,
          riskLevel: typeof payload.risk_level === "string" ? (payload.risk_level as any) : prev.riskLevel,
          emergencyMode: true,
        }));
      }

      if (stage === "ai_timeout") {
        setLiveInfo((prev) => ({
          ...prev,
          aiThinking: false,
          aiSummary: "AI analysis taking longer than usual — proceeding with immediate sensor-based safety protocol."
        }));
      }

      if (stage === "extracting" || stage === "reextracting") {
        setLiveInfo((prev) => ({ ...prev, aiThinking: true }));
      }

      if (stage === "extracted" && typeof payload.emergency_type === "string") {
        setLiveInfo((prev) => ({
          ...prev,
          aiThinking: false,
          aiSummary: typeof payload.reasoning === "string" ? payload.reasoning : prev.aiSummary,
          emergencyType: payload.emergency_type as string,
          confidence:
            typeof payload.raw_confidence === "number"
              ? (payload.raw_confidence as number) * 100
              : prev.confidence,
        }));
      }

      if (
        (stage === "validating" || stage === "revalidating") &&
        typeof payload.confidence === "number"
      ) {
        setLiveInfo((prev) => ({
          ...prev,
          confidence: (payload.confidence as number) * 100,
          band:
            typeof payload.band === "string"
              ? (payload.band as string)
              : prev.band,
        }));
      }

      if (stage === "follow_up") {
        setLiveInfo((prev) => ({
          ...prev,
          followUpQuestion:
            typeof payload.question === "string"
              ? (payload.question as string)
              : prev.followUpQuestion,
          followUpLoop:
            typeof payload.loop === "number"
              ? (payload.loop as number)
              : prev.followUpLoop,
        }));
      }

      // Stream paused waiting for a clarification answer. Capture resume state
      // and show the inline question UI.
      if (stage === "awaiting_follow_up") {
        const question =
          typeof payload.question === "string" ? payload.question : "";
        const transcript =
          typeof payload.resume_transcript === "string"
            ? payload.resume_transcript
            : "";
        const loopsUsed =
          typeof payload.loops_used === "number" ? payload.loops_used : 0;

        setLiveInfo((prev) => ({
          ...prev,
          followUpQuestion: question || prev.followUpQuestion,
          followUpLoop:
            typeof payload.loop === "number"
              ? (payload.loop as number)
              : prev.followUpLoop,
          confidence:
            typeof payload.confidence === "number"
              ? (payload.confidence as number) * 100
              : prev.confidence,
          band:
            typeof payload.band === "string"
              ? (payload.band as string)
              : prev.band,
        }));

        setResumeState({
          resumeTranscript: transcript,
          pendingQuestion: question,
          loopsUsed,
        });
        setAnswerText("");
        setDemoPhase("awaiting_follow_up");
      }

      if (stage === "decision" && typeof payload.confidence === "number") {
        setLiveInfo((prev) => ({
          ...prev,
          confidence: (payload.confidence as number) * 100,
        }));
      }

      if (stage === "error") {
        setError(
          typeof payload.message === "string"
            ? `Error: ${payload.message}`
            : "An unknown error occurred."
        );
        setDemoPhase("idle");
      }

      if (stage === "complete") {
        setAllComplete(true);
        setDemoPhase("complete");
        // Release the demo guard now that the run finished successfully. The
        // refs would otherwise only reset on remount after navigation, leaving
        // the button permanently locked if router.push fails silently.
        demoStartedRef.current = false;
        const result = payload.result ?? {};
        try {
          sessionStorage.setItem("override_result", JSON.stringify(result));
          // Persist the evidence + risk used so the dashboard can rebuild the
          // sensor cards and risk-rules timeline.
          if (evidenceRef.current) {
            sessionStorage.setItem(
              "override_evidence",
              JSON.stringify(evidenceRef.current)
            );
          }
          if (incidentRef.current) {
            sessionStorage.setItem(
              "override_incident",
              JSON.stringify(incidentRef.current)
            );
          }
          if (riskRef.current) {
            sessionStorage.setItem(
              "override_risk",
              JSON.stringify(riskRef.current)
            );
          }
        } catch {
          // ignore storage failures
        }
        // Give the UI a beat to render the final stage before navigating.
        setTimeout(() => {
          router.push("/dashboard");
        }, 600);
      }
    },
    [router]
  );

  // ── Generic SSE reader (replicates the existing /analyze consumer exactly) ──
  const consumeStream = useCallback(
    async (url: string, body: object) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Bad response: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const rawLine = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;

          const jsonStr = line.slice(line.indexOf(":") + 1).trim();
          if (!jsonStr) continue;

          try {
            const payload = JSON.parse(jsonStr) as Record<string, unknown>;
            applyEvent(payload);
          } catch {
            // Ignore malformed lines.
          }
        }
      }
    },
    [applyEvent]
  );

  // ── ▶ Run Demo Scenario ─────────────────────────────────────────────────────
  const runDemo = useCallback(async () => {
    if (demoStartedRef.current) return;
    demoStartedRef.current = true;

    setError(null);
    setAllComplete(false);
    setResumeState(null);
    setAnswerText("");
    setLiveInfo({});
    setActiveIndex(0); // sensors
    setDemoPhase("running");

    // a. Inject the demo spike (clearly DEMO-tagged inside the hook).
    applyDemoSpike({ accelG: 4.2, audio: 78 });

    // b. Wait for the sensor loop to settle the new readings into evidence/risk.
    await new Promise((r) => setTimeout(r, DEMO_SETTLE_MS));

    const evidence = evidenceRef.current ?? fuseSensors(raw);
    const incident = incidentRef.current ?? buildIncident(analyzeEvidence([raw]));
    const risk = riskRef.current ?? (incident ? assessRisk(incident, "") : null);
    evidenceRef.current = evidence;
    incidentRef.current = incident;
    riskRef.current = risk;
    if (risk) setLiveInfo((prev) => ({ ...prev, riskLevel: risk.riskLevel }));

    // c. POST to /sensor-analyze and stream the SSE pipeline.
    const body: SensorAnalyzeBody = {
      evidence: evidenceToBackend(evidence),
      risk: risk ? riskToBackend(risk) : null,
      text: "",
      follow_up_responses: [],
    };

    try {
      await consumeStream(SENSOR_ANALYZE_URL, body);
    } catch {
      setError("Connection error. Is the backend running on port 8000?");
      setDemoPhase("idle");
      demoStartedRef.current = false;
    }
  }, [applyDemoSpike, consumeStream, raw]);

  // ── Submit an inline follow-up answer and resume the stream ──────────────────
  const submitFollowUpAnswer = useCallback(async () => {
    if (!resumeState) return;
    const answer = answerText.trim();
    if (!answer || submittingAnswer) return;

    setSubmittingAnswer(true);
    setError(null);

    const pending = resumeState;
    setResumeState(null);
    setDemoPhase("running");

    const evidence = evidenceRef.current ?? fuseSensors(raw);
    const incident = incidentRef.current ?? buildIncident(analyzeEvidence([raw]));
    const risk = riskRef.current ?? (incident ? assessRisk(incident, "") : null);

    const body: SensorAnalyzeBody = {
      evidence: evidenceToBackend(evidence),
      risk: risk ? riskToBackend(risk) : null,
      text: "",
      resume_transcript: pending.resumeTranscript,
      pending_question: pending.pendingQuestion,
      loops_used: pending.loopsUsed,
      follow_up_responses: [answer],
    };

    try {
      await consumeStream(SENSOR_ANALYZE_URL, body);
    } catch {
      setError("Connection error. Is the backend running on port 8000?");
      // Restore the prompt so the user can retry their answer.
      setResumeState(pending);
      setDemoPhase("awaiting_follow_up");
    } finally {
      setSubmittingAnswer(false);
      setAnswerText("");
    }
  }, [answerText, consumeStream, raw, resumeState, submittingAnswer]);

  // ── Secondary: plain text analysis via the original /analyze endpoint ────────
  const analyzeText = useCallback(async () => {
    const text = callerText.trim();
    if (!text || textSubmitting) return;

    setTextSubmitting(true);
    setError(null);
    setAllComplete(false);
    setResumeState(null);
    setLiveInfo({});
    setActiveIndex(1); // fusion-ish (text path enters at "received")
    setDemoPhase("running");

    try {
      await consumeStream(ANALYZE_URL, {
        text,
        follow_up_responses: [],
      });
    } catch {
      setError("Connection error. Is the backend running on port 8000?");
      setDemoPhase("idle");
    } finally {
      setTextSubmitting(false);
    }
  }, [callerText, consumeStream, textSubmitting]);

  // ── Auto-advance timer ──────────────────────────────────────────────────
  useEffect(() => {
    if (demoPhase === "awaiting_follow_up") {
      const timerId = setTimeout(() => {
        if (riskRef.current) {
          riskRef.current = escalateOnSilence(riskRef.current);
        }

        const pending = resumeState;
        if (!pending) return;

        setResumeState(null);
        setDemoPhase("running");

        const evidence = evidenceRef.current ?? fuseSensors(raw);
        const incident = incidentRef.current ?? buildIncident(analyzeEvidence([raw]));
        const risk = riskRef.current ?? (incident ? assessRisk(incident, "") : null);

        const body: SensorAnalyzeBody & { timed_out?: boolean } = {
          evidence: evidenceToBackend(evidence),
          risk: risk ? riskToBackend(risk) : null,
          text: "",
          resume_transcript: pending.resumeTranscript,
          pending_question: pending.pendingQuestion,
          loops_used: pending.loopsUsed,
          follow_up_responses: [],
          timed_out: true,
        };

        consumeStream(SENSOR_ANALYZE_URL, body).catch(() => {
          setError("Connection error on auto-advance.");
          setResumeState(pending);
          setDemoPhase("awaiting_follow_up");
        });
      }, 5000);
      return () => clearTimeout(timerId);
    }
  }, [demoPhase, consumeStream, raw, resumeState]);

  const isProcessing = demoPhase === "running" || textSubmitting;

  const getEmergencyState = (): import("./components/types").EmergencyState => {
    if (activeIndex >= 5 || allComplete) return "Response Active";
    if (incidentRef.current?.confidenceBand === "Confirmed" || liveInfo.emergencyMode) return "Emergency Confirmed";
    if (incidentRef.current?.confidenceBand === "Possible") return "Possible Emergency";
    if (incidentRef.current?.confidenceBand === "Suspicious" || activeIndex >= 1) return "Suspicious Activity";
    return "Monitoring";
  };

  return (
    <main className="relative min-h-screen w-full bg-[#0a0a0a] text-white">
      {liveInfo.emergencyMode && <div className="ov-emergency-backdrop" />}
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10">
        
        <EmergencyLifecycle currentState={getEmergencyState()} />
        
        {/* Header */}
        <header className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-5xl font-bold tracking-widest">OVERRIDE</h1>
          <p className="text-sm text-gray-400">
            Sensor-first AI Decision Engine for Emergencies
          </p>
        </header>

        {/* Gate: enable sensors before anything else (no auto-prompting). */}
        {!permissionsGranted ? (
          <section className="flex flex-col items-center gap-4 py-16">
            <p className="max-w-md text-center text-sm text-gray-400">
              Override reads your device sensors (GPS, motion, microphone level,
              battery) to detect emergencies. Nothing is sent anywhere until you
              run an analysis.
            </p>
            <Button
              type="button"
              onClick={handleEnableSensors}
              className="h-14 rounded-xl bg-white px-8 text-lg font-bold text-black hover:bg-white/90"
            >
              Enable Sensors
            </Button>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </section>
        ) : (
          <>
            {/* Primary CTA — Run Demo Scenario. */}
            <section className="flex flex-col items-center gap-3">
              <Button
                type="button"
                onClick={runDemo}
                disabled={isProcessing || demoPhase === "complete"}
                className="h-16 w-full max-w-md rounded-xl bg-orange-500 text-xl font-bold text-black shadow-[0_0_30px_-8px_rgba(249,115,22,0.8)] hover:bg-orange-400 disabled:opacity-50"
              >
                ▶ Run Demo Scenario
              </Button>
              <p className="text-xs text-gray-500">
                Injects a simulated fall/impact spike (4.2 g + 78 RMS) —
                everything simulated is tagged with an orange DEMO badge.
              </p>
            </section>

            {/* Inline follow-up question card (shown when stream paused). */}
            {resumeState && demoPhase === "awaiting_follow_up" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitFollowUpAnswer();
                }}
                className="flex flex-col gap-3 rounded-xl border border-amber-400/40 bg-amber-400/5 p-5"
              >
                <div className="flex items-center justify-between text-sm font-semibold text-amber-200">
                  <span>⚠ One question to confirm</span>
                  <svg width="24" height="24" className="-rotate-90">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
                    <circle cx="12" cy="12" r="10" fill="none" stroke="#fbbf24" strokeWidth="3"
                      strokeDasharray="62.83"
                      style={{ "--ov-ring-circ": 62.83, animation: "ov-ring-deplete 5s linear forwards" } as React.CSSProperties}
                    />
                  </svg>
                </div>
                <p className="text-base text-white">
                  {resumeState.pendingQuestion ||
                    "Please provide more information."}
                </p>
                <input
                  type="text"
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  autoFocus
                  disabled={submittingAnswer}
                  placeholder="Type your answer…"
                  className="h-12 w-full rounded-lg border border-white/20 bg-black/40 px-4 text-white placeholder:text-gray-500 focus:border-amber-400/60 focus:outline-none"
                />
                <Button
                  type="submit"
                  disabled={submittingAnswer || !answerText.trim()}
                  className="h-12 rounded-lg bg-amber-400/90 font-medium text-black hover:bg-amber-300 disabled:opacity-50"
                >
                  {submittingAnswer ? "Sending…" : "Submit Answer"}
                </Button>
              </form>
            )}

            {/* Pipeline + live info, side by side on wide screens. */}
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="flex flex-col gap-3 lg:col-span-2">
                 <DemoBadge readings={readings} />
              </div>
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                  Pipeline
                </h2>
                {liveInfo.headline && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center font-bold text-red-400">
                    {liveInfo.headline}
                  </div>
                )}
                <Pipeline
                  activeIndex={activeIndex}
                  allComplete={allComplete}
                  sensors={readings}
                  aiThinking={liveInfo.aiThinking}
                />
              </div>

              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                  Live Analysis
                </h2>
                <LiveInfoCard
                  info={liveInfo}
                  riskLevel={liveInfo.riskLevel}
                  sensors={readings}
                />
              </div>
            </section>

            {/* Full sensor grid. */}
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                Sensors
              </h2>
              <SensorGrid readings={readings} />
            </section>

            {error && (
              <p className="text-center text-sm text-red-400">{error}</p>
            )}

            {/* Secondary, de-emphasised: optional caller-context text flow. */}
            <section className="mt-4 flex flex-col gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Optional: describe the situation (text-only flow)
              </h2>
              <textarea
                value={callerText}
                onChange={(e) => setCallerText(e.target.value)}
                rows={3}
                placeholder="e.g. My dad collapsed and isn't responding…"
                className="w-full resize-none rounded-lg border border-white/10 bg-black/40 p-3 text-sm text-white placeholder:text-gray-600 focus:border-white/30 focus:outline-none"
              />
              <Button
                type="button"
                onClick={analyzeText}
                disabled={textSubmitting || !callerText.trim()}
                variant="outline"
                className="h-10 w-fit rounded-lg border-white/15 bg-transparent text-sm text-gray-300 hover:bg-white/10 disabled:opacity-50"
              >
                {textSubmitting ? "Analyzing…" : "Analyze Text"}
              </Button>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
