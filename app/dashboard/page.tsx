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
// Clinical severity derivation
// ---------------------------------------------------------------------------
//
// IMPORTANT: validation `confidence` measures *evidence completeness* — how
// many fields we managed to extract — NOT clinical severity. A fully-answered
// case where the victim is breathing, has a pulse and is conscious can score a
// very high confidence, but that emphatically does NOT mean a cardiac arrest is
// underway. Severity must therefore be derived from the extracted *clinical*
// fields (arrest indicators) and the emergency type, never from the score.
//
// Arrest indicators (any one true → treat as cardiac arrest / CPR-indicated):
//   - victim_breathing === false   (not breathing)
//   - victim_pulse_present === false (no pulse)
//   - victim_conscious === false    (unresponsive)
//
// Definitive "not in arrest" signal: breathing AND pulse both confirmed true.

interface ClinicalState {
  // True only when extracted vitals positively indicate cardiac arrest.
  isArrest: boolean;
  // True when breathing and pulse are both confirmed present (not in arrest).
  vitalsReassuring: boolean;
  // True when we cannot tell either way (vitals unknown).
  vitalsUnknown: boolean;
}

function deriveClinicalState(result: EmergencyResult): ClinicalState {
  const breathing = result.victim_breathing;
  const pulse = result.victim_pulse_present;
  const conscious = result.victim_conscious;

  const isArrest =
    breathing === false || pulse === false || conscious === false;

  const vitalsReassuring = breathing === true && pulse === true;

  // Unknown when no arrest indicator is present and vitals are not both
  // confirmed (i.e. at least one of breathing/pulse is null/undefined).
  const vitalsUnknown =
    !isArrest &&
    !vitalsReassuring &&
    (breathing === null ||
      breathing === undefined ||
      pulse === null ||
      pulse === undefined);

  return { isArrest, vitalsReassuring, vitalsUnknown };
}

// ---------------------------------------------------------------------------
// Section 1 — Severity Banner
// ---------------------------------------------------------------------------
//
// The banner reflects CLINICAL severity derived from the extracted fields and
// emergency type — not the validation confidence score. `confidence`/`forced`
// are used only to surface the "decided under uncertainty" caveat, never to
// upgrade the severity itself.
function SeverityBanner({
  result,
  forced,
}: {
  result: EmergencyResult;
  forced: boolean;
}) {
  const { isArrest, vitalsReassuring } = deriveClinicalState(result);
  const emergencyType = (result.emergency_type ?? "").trim();
  const typeKnown = emergencyType !== "" && emergencyType !== "Unknown";
  const typeLabel = typeKnown ? emergencyType.toUpperCase() : "EMERGENCY";

  let bannerClass: string;
  let bannerText: string;

  if (isArrest) {
    // Extracted vitals positively indicate arrest → genuine critical event.
    bannerClass = "bg-red-600 text-white";
    bannerText = "🔴 CRITICAL — CARDIAC ARREST";
  } else if (vitalsReassuring) {
    // Breathing AND pulse confirmed present → NOT an arrest. Still a real
    // emergency that needs help, but do not cry "cardiac event".
    bannerClass = "bg-orange-600 text-white";
    bannerText = typeKnown
      ? `🟠 ${typeLabel} — VITALS PRESENT, MONITOR CLOSELY`
      : "🟠 EMERGENCY — VITALS PRESENT, MONITOR CLOSELY";
  } else {
    // Vitals not established either way → treat cautiously as an emergency.
    bannerClass = "bg-yellow-600 text-black";
    bannerText = typeKnown
      ? `⚠ ${typeLabel} — VITALS UNCONFIRMED, TREAT AS EMERGENCY`
      : "⚠ UNCERTAIN — TREAT AS EMERGENCY";
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
//
// CPR guidance must only be offered when the extracted vitals actually warrant
// it. The dashboard receives the full result so this component can decide for
// itself: CPR is shown only when an arrest indicator is present (or vitals are
// unknown so arrest cannot be ruled out). When breathing AND pulse are both
// confirmed present, starting CPR is contraindicated, so the card is hidden and
// replaced with a "do NOT start CPR" advisory.
function ActionCards({ result }: { result: EmergencyResult }) {
  const { isArrest, vitalsReassuring } = deriveClinicalState(result);
  // Offer CPR when arrest is indicated, or when vitals are not confirmed
  // present (so we cannot rule arrest out). Suppress only when breathing and
  // pulse are both positively confirmed.
  const showCpr = !vitalsReassuring;

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

      {/* Card 2 — Begin CPR (only when arrest is indicated / not ruled out) */}
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
          className="mb-3 cursor-pointer rounded-xl bg-white/5 p-5 transition-colors hover:bg-white/10"
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
        // Breathing AND pulse both confirmed present → CPR is contraindicated.
        <div className="mb-3 rounded-xl border border-green-500/30 bg-green-500/5 p-5">
          <p className="text-xl font-bold text-green-300">
            🫀 Do NOT start CPR
          </p>
          <p className="mt-1 text-sm text-gray-300">
            The person is breathing and has a pulse. Keep them calm, monitor
            them closely, and be ready to start CPR only if they stop breathing
            or become unresponsive.
          </p>
        </div>
      )}

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
            <iframe
              title="Your location"
              width="100%"
              height="200"
              style={{ border: 0, borderRadius: "8px", marginTop: "8px" }}
              loading="lazy"
              src={`https://www.google.com/maps?q=${coords.lat},${coords.lng}&z=15&output=embed`}
            />
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

  return (
    <main className="min-h-screen w-full bg-[#0a0a0a] text-white">
      {/* Section 1 — full-width severity banner (derived from clinical fields) */}
      <SeverityBanner result={result} forced={Boolean(result.forced)} />

      <div className="mx-auto w-full max-w-xl px-4 py-4">
        {/* Section 2 — confidence */}
        <ConfidenceCard result={result} />

        {/* Section 3 — action cards (CPR gated on arrest indicators) */}
        <ActionCards result={result} />

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
