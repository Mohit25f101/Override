"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
//
// The dashboard consumes the merged EmergencyExtraction + ValidationResult
// object produced by the backend and stashed in sessionStorage under
// "emergencyResult" by the home page. `confidence` and `raw_confidence` are
// 0..1 floats here (the backend stores them un-scaled).
interface EmergencyResult {
  emergency_type?: string;
  victim_breathing?: boolean | null;
  victim_conscious?: boolean | null;
  victim_pulse_present?: boolean | null;
  chest_pain_reported?: boolean | null;
  location_mentioned?: string | null;
  confidence?: number; // 0..1
  forced?: boolean;
  warning?: string | null;
  action_ready?: boolean;
  missing_fields?: string[];
  loops_used?: number;
  reasoning?: string;
  // Allow any extra fields without losing type-safety on the ones we use.
  [key: string]: unknown;
}

// Fields shown in the "Evidence Collected" list, with their human labels.
const EVIDENCE_FIELDS: { key: keyof EmergencyResult; label: string }[] = [
  { key: "victim_breathing", label: "Breathing" },
  { key: "victim_conscious", label: "Conscious" },
  { key: "victim_pulse_present", label: "Pulse present" },
  { key: "chest_pain_reported", label: "Chest pain reported" },
  { key: "location_mentioned", label: "Location" },
];

const CPR_STEPS = [
  "Place heel of hand on center of chest",
  "Push down hard and fast — 5-6 cm depth",
  "Rate: 100-120 compressions per minute",
  "After 30 compressions: give 2 rescue breaths",
  "Continue until ambulance arrives",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render a stored value as Yes / No / its string value. */
function formatEvidenceValue(value: unknown): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return String(value);
}

/** Color class for the confidence number, by 0..1 band. */
function confidenceTextColor(confidence: number): string {
  if (confidence >= 0.85) return "text-green-400";
  if (confidence >= 0.6) return "text-orange-400";
  return "text-red-400";
}

// ---------------------------------------------------------------------------
// Section 1 — Severity Banner
// ---------------------------------------------------------------------------
function SeverityBanner({
  confidence,
  forced,
}: {
  confidence: number;
  forced: boolean;
}) {
  let bannerClass: string;
  let bannerText: string;

  if (confidence >= 0.85) {
    bannerClass = "bg-red-600 text-white";
    bannerText = "🔴 CRITICAL — CARDIAC EVENT";
  } else if (confidence >= 0.6) {
    bannerClass = "bg-orange-600 text-white";
    bannerText = "🟠 HIGH RISK — POSSIBLE CARDIAC EVENT";
  } else {
    bannerClass = "bg-yellow-600 text-black";
    bannerText = "⚠ UNCERTAIN — TREAT AS EMERGENCY";
  }

  return (
    <div className={`w-full px-4 py-6 text-center ${bannerClass}`}>
      <p className="text-2xl font-bold">{bannerText}</p>
      {forced && (
        <p className="mt-2 text-sm font-medium opacity-90">
          Decision made under uncertainty. Do not wait — call emergency
          services now.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Confidence Card
// ---------------------------------------------------------------------------
function ConfidenceCard({ result }: { result: EmergencyResult }) {
  const confidence = typeof result.confidence === "number" ? result.confidence : 0;
  const percent = Math.round(confidence * 100);

  return (
    <div className="mb-4 rounded-xl bg-white/5 p-4">
      <p className={`text-4xl font-bold ${confidenceTextColor(confidence)}`}>
        Confidence: {percent}%
      </p>

      <div className="mt-3">
        <Progress value={Math.max(0, Math.min(100, percent))} />
      </div>

      <p className="mt-4 mb-2 font-semibold text-white">Evidence Collected:</p>
      <ul className="space-y-1 text-sm">
        {EVIDENCE_FIELDS.map(({ key, label }) => {
          const value = result[key];
          const isKnown = value !== null && value !== undefined;
          return (
            <li
              key={String(key)}
              className={isKnown ? "text-green-400" : "text-gray-500"}
            >
              {isKnown
                ? `✓ ${label}: ${formatEvidenceValue(value)}`
                : `✗ ${label}: Unknown`}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Action Cards
// ---------------------------------------------------------------------------
function ActionCards() {
  const [cprOpen, setCprOpen] = useState(false);
  const [locStatus, setLocStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );

  const requestLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocStatus("error");
      return;
    }
    setLocStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocStatus("success");
      },
      () => {
        setLocStatus("error");
      }
    );
  };

  const coordString = coords
    ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`
    : "";

  const copyCoords = () => {
    if (coordString && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(coordString).catch(() => {
        /* clipboard may be unavailable — ignore */
      });
    }
  };

  return (
    <div>
      {/* Card 1 — Call Emergency Services */}
      <a href="tel:112" className="block">
        <div className="mb-3 rounded-xl bg-white/5 p-5 transition-colors hover:bg-white/10">
          <p className="text-xl font-bold text-white">
            <span className="text-red-400">🚨</span> Call Emergency Services
          </p>
          <p className="mt-1 text-sm text-gray-400">
            112 — National Emergency Number
          </p>
        </div>
      </a>

      {/* Card 2 — Begin CPR */}
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
        className="mb-3 cursor-pointer rounded-xl bg-white/5 p-5 transition-colors hover:bg-white/10"
      >
        <p className="text-xl font-bold text-white">
          🫀 Begin CPR{" "}
          <span className="text-sm font-normal text-gray-400">
            {cprOpen ? "▲" : "▼"}
          </span>
        </p>
        {cprOpen && (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-gray-300">
            {CPR_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
      </div>

      {/* Card 3 — Share My Location */}
      <div
        role="button"
        tabIndex={0}
        onClick={requestLocation}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            requestLocation();
          }
        }}
        className="mb-3 cursor-pointer rounded-xl bg-white/5 p-5 transition-colors hover:bg-white/10"
      >
        <p className="text-xl font-bold text-white">📍 Share My Location</p>

        {locStatus === "loading" && (
          <p className="mt-2 text-sm text-gray-400">Locating…</p>
        )}

        {locStatus === "success" && coords && (
          <div className="mt-2 text-sm text-gray-300">
            <p>Latitude: {coords.lat.toFixed(6)}</p>
            <p>Longitude: {coords.lng.toFixed(6)}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded bg-black/40 px-2 py-1 text-xs text-green-400">
                {coordString}
              </code>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copyCoords();
                }}
                className="rounded border border-white/20 px-2 py-1 text-xs text-gray-300 hover:bg-white/10"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {locStatus === "error" && (
          <p className="mt-2 text-sm text-gray-400">
            Location unavailable — describe your location verbally
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 4 — Reasoning Trace (collapsible)
// ---------------------------------------------------------------------------
function ReasoningTrace({ result }: { result: EmergencyResult }) {
  const [open, setOpen] = useState(false);
  const confidence = typeof result.confidence === "number" ? result.confidence : 0;
  const percent = Math.round(confidence * 100);

  return (
    <div className="mb-4 rounded-xl bg-white/5 p-4 text-sm text-gray-300">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left font-semibold text-white"
      >
        How the Decision Engine Reasoned {open ? "▲" : "▼"}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <p>Gemini classification: {result.emergency_type ?? "Unknown"}</p>
          <p>Initial reasoning: {result.reasoning ?? "—"}</p>
          <p>Validation loops run: {result.loops_used ?? 0} / 2</p>
          <p>Final confidence: {percent}%</p>
          {result.forced && (
            <p className="text-orange-400">
              ⚠ Confidence threshold not reached — forced action applied
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const router = useRouter();
  const [result, setResult] = useState<EmergencyResult | null>(null);
  const [ready, setReady] = useState(false);

  // On mount: hydrate from sessionStorage or bounce home.
  useEffect(() => {
    let parsed: EmergencyResult | null = null;
    try {
      const raw = sessionStorage.getItem("emergencyResult");
      if (raw) parsed = JSON.parse(raw) as EmergencyResult;
    } catch {
      parsed = null;
    }

    if (!parsed) {
      router.replace("/");
      return;
    }

    setResult(parsed);
    setReady(true);
  }, [router]);

  const handleReset = () => {
    try {
      sessionStorage.removeItem("emergencyResult");
    } catch {
      /* ignore storage failures */
    }
    router.push("/");
  };

  // Render nothing until we know whether we have data (avoids a flash before
  // the redirect fires).
  if (!ready || !result) {
    return <div className="min-h-screen w-full bg-[#0a0a0a]" />;
  }

  const confidence =
    typeof result.confidence === "number" ? result.confidence : 0;

  return (
    <main className="min-h-screen w-full bg-[#0a0a0a] text-white">
      {/* Section 1 — full-width severity banner */}
      <SeverityBanner confidence={confidence} forced={Boolean(result.forced)} />

      <div className="mx-auto w-full max-w-xl px-4 py-4">
        {/* Section 2 — confidence */}
        <ConfidenceCard result={result} />

        {/* Section 3 — action cards */}
        <ActionCards />

        {/* Section 4 — reasoning trace */}
        <ReasoningTrace result={result} />

        {/* Section 5 — reset */}
        <Button
          type="button"
          onClick={handleReset}
          className="h-12 w-full rounded-xl border border-white/20 bg-transparent text-gray-400 hover:bg-white/10 hover:text-white"
        >
          ← New Emergency
        </Button>
      </div>
    </main>
  );
}
