"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { SensorGrid } from "../components/SensorGrid";
import type {
  EvidenceObject,
  RiskAssessment,
  RiskLevel,
  SensorKey,
  SensorReading,
} from "../components/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const ANALYZE_URL = `${API_BASE}/analyze`;

// ─────────────────────────────────────────────────────────────────────────────
// Types — merged EmergencyExtraction + ValidationResult from the SSE "complete"
// event (confidence is a 0..1 float here, matching the backend).
// ─────────────────────────────────────────────────────────────────────────────
interface EmergencyResult {
  emergency_type?: string;
  victim_breathing?: boolean | null;
  victim_conscious?: boolean | null;
  victim_pulse_present?: boolean | null;
  chest_pain_reported?: boolean | null;
  location_mentioned?: string | null;
  confidence?: number; // 0..1
  confidence_band?: string; // PROCEED | ASK_ONE | UNCERTAIN
  forced?: boolean;
  warning?: string | null;
  action_ready?: boolean;
  missing_fields?: string[];
  loops_used?: number;
  reasoning?: string;
  [key: string]: unknown;
}

const CPR_STEPS = [
  "Place heel of hand on center of chest",
  "Push down hard and fast — 5-6 cm depth",
  "Rate: 100-120 compressions per minute",
  "After 30 compressions: give 2 rescue breaths",
  "Continue until ambulance arrives",
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — reconstruct SensorReading[] from a stored EvidenceObject so the
// dashboard can render the same honest live/demo/unavailable badges.
// ─────────────────────────────────────────────────────────────────────────────
function readingsFromEvidence(
  ev: EvidenceObject | null
): SensorReading[] {
  if (!ev) return [];

  const isDemo = (k: SensorKey) => ev.demoSources.includes(k);
  const isLive = (k: SensorKey) => ev.sourcesUsed.includes(k);
  const availability = (k: SensorKey, present: boolean) =>
    isDemo(k) ? "demo" : isLive(k) || present ? "live" : "unavailable";

  return [
    {
      key: "gps",
      label: "GPS",
      icon: "📍",
      availability: availability("gps", ev.locationAvailable),
      value:
        ev.speedKmh !== null && ev.speedKmh !== undefined
          ? `${ev.speedKmh.toFixed(0)} km/h`
          : ev.locationAvailable
          ? "located"
          : "—",
    },
    {
      key: "motion",
      label: "Motion",
      icon: "📱",
      availability: availability("motion", ev.motionAnomaly !== null),
      value:
        ev.motionAnomaly === null
          ? "—"
          : ev.motionAnomaly
          ? "spike"
          : "normal",
    },
    {
      key: "audio",
      label: "Audio",
      icon: "🎤",
      availability: availability("audio", ev.audioLevel !== null),
      value:
        ev.audioLevel !== null && ev.audioLevel !== undefined
          ? `${Math.round(ev.audioLevel)} RMS`
          : "—",
    },
    {
      key: "battery",
      label: "Battery",
      icon: "🔋",
      availability: availability("battery", ev.batteryLow !== null),
      value:
        ev.batteryLow === null
          ? "—"
          : ev.batteryLow
          ? "low (<15%)"
          : "ok",
    },
  ];
}

// Clinical derivation (kept from the original dashboard — severity comes from
// extracted vitals, NOT from the confidence score).
function deriveClinical(result: EmergencyResult) {
  const breathing = result.victim_breathing;
  const pulse = result.victim_pulse_present;
  const conscious = result.victim_conscious;

  const isArrest =
    breathing === false || pulse === false || conscious === false;
  const vitalsReassuring = breathing === true && pulse === true;
  return { isArrest, vitalsReassuring };
}

// Risk-level banner styling.
function bannerClasses(level: RiskLevel): string {
  switch (level) {
    case "CRITICAL":
      return "bg-red-700 text-white";
    case "HIGH":
      return "bg-amber-600 text-white";
    case "MODERATE":
      return "bg-yellow-500 text-black";
    case "LOW":
      return "bg-green-600 text-white";
    case "UNKNOWN":
    default:
      return "bg-gray-600 text-white";
  }
}

function bandPillClasses(band: string | undefined): string {
  switch (band) {
    case "PROCEED":
      return "bg-green-500/15 text-green-300 border-green-500/50";
    case "ASK_ONE":
      return "bg-yellow-500/15 text-yellow-300 border-yellow-500/50";
    case "UNCERTAIN":
      return "bg-red-500/15 text-red-300 border-red-500/50";
    default:
      return "bg-gray-500/15 text-gray-300 border-gray-500/40";
  }
}

function bandFromConfidence(result: EmergencyResult): string {
  if (typeof result.confidence_band === "string") return result.confidence_band;
  const c = typeof result.confidence === "number" ? result.confidence : 0;
  if (c >= 0.85) return "PROCEED";
  if (c >= 0.6) return "ASK_ONE";
  return "UNCERTAIN";
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const [result, setResult] = useState<EmergencyResult | null>(null);
  const [evidence, setEvidence] = useState<EvidenceObject | null>(null);
  const [risk, setRisk] = useState<RiskAssessment | null>(null);
  const [ready, setReady] = useState(false);
  const [loadedAt] = useState(() => Date.now());

  useEffect(() => {
    let parsed: EmergencyResult | null = null;
    try {
      const raw =
        sessionStorage.getItem("override_result") ??
        sessionStorage.getItem("emergencyResult");
      if (raw) parsed = JSON.parse(raw) as EmergencyResult;
    } catch {
      parsed = null;
    }

    if (!parsed) {
      router.replace("/");
      return;
    }

    try {
      const ev = sessionStorage.getItem("override_evidence");
      if (ev) setEvidence(JSON.parse(ev) as EvidenceObject);
    } catch {
      /* ignore */
    }
    try {
      const rk = sessionStorage.getItem("override_risk");
      if (rk) setRisk(JSON.parse(rk) as RiskAssessment);
    } catch {
      /* ignore */
    }

    setResult(parsed);
    setReady(true);
  }, [router]);

  const readings = useMemo(() => readingsFromEvidence(evidence), [evidence]);

  if (!ready || !result) {
    return <div className="min-h-screen w-full bg-[#0a0a0a]" />;
  }

  const riskLevel: RiskLevel = risk?.riskLevel ?? "UNKNOWN";
  const { isArrest, vitalsReassuring } = deriveClinical(result);
  const showCpr = !vitalsReassuring; // CPR offered unless vitals confirmed safe
  const cprActive =
    result.victim_breathing === false || result.victim_pulse_present === false;
  const confidencePct = Math.round((result.confidence ?? 0) * 100);
  const band = bandFromConfidence(result);

  // emergency_type from Gemini vs. emergencyType from the Risk Engine.
  const geminiType = (result.emergency_type ?? "").trim();
  const riskType = (risk?.emergencyType ?? "").trim();
  const typesDiffer =
    geminiType && riskType && geminiType.toLowerCase() !== riskType.toLowerCase();

  return (
    <main className="min-h-screen w-full bg-[#0a0a0a] text-white">
      {/* ── SECTION 1 — Emergency status banner (full-width) ───────────────── */}
      <div
        className={cn(
          "w-full px-4 py-6 text-center",
          bannerClasses(riskLevel)
        )}
      >
        <p className="text-2xl font-bold tracking-wide">
          {riskLevel} EMERGENCY
        </p>
        <p className="mt-1 text-base font-medium opacity-95">
          {riskType || "Unknown"}
          {typesDiffer && (
            <span className="opacity-80">
              {" "}
              · Gemini: {geminiType}
            </span>
          )}
          {!typesDiffer && geminiType && !riskType && <span>{geminiType}</span>}
        </p>
        {result.forced && (
          <p className="mt-2 text-sm font-medium opacity-90">
            ⚠ Decision forced after max loops — do not wait, call emergency
            services now.
          </p>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5">
        {/* ── SECTION 2 — Sensor status row ──────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Sensor Status
          </h2>
          {readings.length > 0 ? (
            <SensorGrid readings={readings} compact={false} />
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-500">
              Sensor data unavailable
            </div>
          )}
        </section>

        {/* ── SECTION 3 — Evidence timeline ──────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Evidence Timeline
          </h2>
          <EvidenceTimeline
            risk={risk}
            evidence={evidence}
            result={result}
            band={band}
            confidencePct={confidencePct}
            loadedAt={loadedAt}
          />
        </section>

        {/* ── SECTION 4 — Confidence score + CVL band ────────────────────── */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Confidence
              </p>
              <p
                className={cn(
                  "text-5xl font-bold",
                  confidencePct >= 85
                    ? "text-green-400"
                    : confidencePct >= 60
                    ? "text-orange-400"
                    : "text-red-400"
                )}
              >
                {confidencePct}%
              </p>
            </div>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-4 py-1 text-sm font-bold tracking-wide",
                bandPillClasses(band)
              )}
            >
              {band}
            </span>
          </div>
          <div className="mt-3">
            <Progress value={Math.max(0, Math.min(100, confidencePct))} />
          </div>
          {result.forced && (
            <p className="mt-3 text-sm font-medium text-orange-400">
              ⚠ Decision forced after max loops
            </p>
          )}
        </section>

        {/* ── SECTION 5 — Risk analysis (rules fired) ────────────────────── */}
        <RiskAnalysis risk={risk} />

        {/* ── SECTION 6 — Recommended actions ────────────────────────────── */}
        <RecommendedActions
          showCpr={showCpr}
          isArrest={isArrest}
          cprActive={cprActive}
          evidence={evidence}
        />

        {/* ── SECTION 7 — Optional chat (below the fold) ──────────────────── */}
        <OptionalChat />

        <Button
          type="button"
          onClick={() => {
            try {
              sessionStorage.removeItem("override_result");
              sessionStorage.removeItem("override_evidence");
              sessionStorage.removeItem("override_risk");
            } catch {
              /* ignore */
            }
            router.push("/");
          }}
          className="h-12 w-full rounded-xl border border-white/20 bg-transparent text-gray-400 hover:bg-white/10 hover:text-white"
        >
          ← New Emergency
        </Button>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — Evidence timeline (newest first).
// ─────────────────────────────────────────────────────────────────────────────
function EvidenceTimeline({
  risk,
  evidence,
  result,
  band,
  confidencePct,
  loadedAt,
}: {
  risk: RiskAssessment | null;
  evidence: EvidenceObject | null;
  result: EmergencyResult;
  band: string;
  confidencePct: number;
  loadedAt: number;
}) {
  const fmt = (ts: number) =>
    new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const sensorTs = evidence?.timestamp ?? loadedAt;

  // Build entries, newest first.
  const entries: { time: number; text: string }[] = [];

  // CVL decision (most recent).
  entries.push({
    time: loadedAt,
    text: `CVL decision: ${band} — confidence: ${confidencePct}%`,
  });

  // Gemini extraction.
  entries.push({
    time: loadedAt,
    text: `Gemini extraction complete — emergency_type: ${
      result.emergency_type ?? "Unknown"
    }`,
  });

  // Each rule fired (timestamped to the evidence capture).
  (risk?.rulesFired ?? []).forEach((rule) => {
    entries.push({ time: sensorTs, text: rule });
  });

  return (
    <ol className="flex flex-col gap-3 border-l border-white/15 pl-5">
      {entries.map((e, i) => (
        <li key={i} className="relative">
          <span
            className="absolute -left-[1.45rem] top-1 h-2.5 w-2.5 rounded-full bg-blue-400"
            aria-hidden
          />
          <p className="text-sm text-gray-200">{e.text}</p>
          <p className="font-mono text-[11px] text-gray-500">{fmt(e.time)}</p>
        </li>
      ))}
    </ol>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 — Risk analysis (collapsible, open by default).
// ─────────────────────────────────────────────────────────────────────────────
function RiskAnalysis({ risk }: { risk: RiskAssessment | null }) {
  const [open, setOpen] = useState(true);
  const rules = risk?.rulesFired ?? [];

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-semibold text-white">
          Why this risk level was assigned
        </span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-300">
          {rules.length > 0 ? (
            rules.map((r, i) => <li key={i}>{r}</li>)
          ) : (
            <li className="list-none text-gray-500">
              No rule details available.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6 — Recommended actions (CPR gate + location + dialer).
// ─────────────────────────────────────────────────────────────────────────────
function RecommendedActions({
  showCpr,
  isArrest,
  cprActive,
  evidence,
}: {
  showCpr: boolean;
  isArrest: boolean;
  cprActive: boolean;
  evidence: EvidenceObject | null;
}) {
  const [cprOpen, setCprOpen] = useState(cprActive);

  // GPS coords are not stored in the EvidenceObject (only availability/speed),
  // so we offer to fetch the live position on demand when location is available.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [locStatus, setLocStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");

  const locationAvailable = evidence?.locationAvailable ?? false;

  const shareLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocStatus("error");
      return;
    }
    setLocStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        setLocStatus("success");
        const url = `https://www.google.com/maps?q=${lat},${lng}`;
        window.open(url, "_blank", "noopener,noreferrer");
      },
      () => setLocStatus("error")
    );
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
        Recommended Actions
      </h2>

      {/* CPR card — gated on arrest indicators, red pulsing border when active. */}
      {showCpr ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setCprOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setCprOpen((o) => !o);
            }
          }}
          className={cn(
            "cursor-pointer rounded-xl border bg-white/5 p-5 transition-colors hover:bg-white/10",
            cprActive
              ? "animate-pulse border-red-500 shadow-[0_0_24px_-6px_rgba(239,68,68,0.9)]"
              : "border-white/10"
          )}
        >
          <p className="text-xl font-bold text-white">
            🫀 Begin CPR{" "}
            <span className="text-sm font-normal text-gray-400">
              {cprOpen ? "▲" : "▼"}
            </span>
          </p>
          {!isArrest && (
            <p className="mt-1 text-sm text-yellow-300">
              Only if the person becomes unresponsive and stops breathing
              normally.
            </p>
          )}
          {cprOpen && (
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-gray-300">
              {CPR_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-5">
          <p className="text-xl font-bold text-green-300">🫀 Do NOT start CPR</p>
          <p className="mt-1 text-sm text-gray-300">
            The person is breathing and has a pulse. Keep them calm, monitor
            closely, and be ready to start CPR only if they stop breathing or
            become unresponsive.
          </p>
        </div>
      )}

      {/* Share location. */}
      <div
        role="button"
        tabIndex={0}
        onClick={shareLocation}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            shareLocation();
          }
        }}
        className="cursor-pointer rounded-xl border border-white/10 bg-white/5 p-5 transition-colors hover:bg-white/10"
      >
        <p className="text-xl font-bold text-white">📍 Share Location</p>
        {locStatus === "idle" && (
          <p className="mt-1 text-sm text-gray-400">
            {locationAvailable
              ? "Opens Google Maps with your GPS coordinates"
              : "Location unavailable — tap to try fetching it now"}
          </p>
        )}
        {locStatus === "loading" && (
          <p className="mt-1 text-sm text-gray-400">Locating…</p>
        )}
        {locStatus === "success" && coords && (
          <p className="mt-1 text-sm text-green-400">
            Opened maps at {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </p>
        )}
        {locStatus === "error" && (
          <p className="mt-1 text-sm text-gray-400">Location unavailable</p>
        )}
      </div>

      {/* Call emergency services — a link, NOT automatic calling. */}
      <a href="tel:112" className="block">
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 transition-colors hover:bg-white/10">
          <p className="text-xl font-bold text-white">
            <span className="text-red-400">🚨</span> Call Emergency Services
          </p>
          <p className="mt-1 text-sm text-gray-400">
            112 — Opens your dialler (does not dial automatically)
          </p>
        </div>
      </a>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 7 — Optional chat (de-emphasised, below the fold).
// ─────────────────────────────────────────────────────────────────────────────
function OptionalChat() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  const send = async () => {
    const t = text.trim();
    if (!t || status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch(ANALYZE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ text: t, follow_up_responses: [] }),
      });
      // Drain the stream so the request completes; we don't re-render the
      // pipeline here — this is just supplementary context.
      if (res.body) {
        const reader = res.body.getReader();
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
      setStatus("sent");
      setText("");
    } catch {
      setStatus("error");
    }
  };

  return (
    <section className="mt-2 rounded-xl border border-white/5 bg-white/[0.02] p-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Add more context (optional)
      </h3>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Any additional details for the dispatcher…"
        className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-black/40 p-3 text-sm text-white placeholder:text-gray-600 focus:border-white/30 focus:outline-none"
      />
      <Button
        type="button"
        onClick={send}
        disabled={status === "sending" || !text.trim()}
        variant="outline"
        className="mt-2 h-10 w-fit rounded-lg border-white/15 bg-transparent text-sm text-gray-400 hover:bg-white/10 disabled:opacity-50"
      >
        {status === "sending"
          ? "Sending…"
          : status === "sent"
          ? "Sent ✓"
          : "Send"}
      </Button>
      {status === "error" && (
        <p className="mt-2 text-sm text-red-400">
          Could not send — is the backend running?
        </p>
      )}
    </section>
  );
}
