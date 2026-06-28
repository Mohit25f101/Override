// app/lib/riskEngine.ts
//
// Risk Engine — transparent, rule-based emergency triage.
//
// Input : an EvidenceObject (from sensorFusion) + optional caller text.
// Output: a RiskAssessment { riskLevel, emergencyType, confidence,
//                            missingEvidence, rulesFired }.
//
// Design rules:
//   * NO machine learning, NO black boxes. Every decision is a plain rule with
//     a human-readable explanation pushed into `rulesFired`.
//   * If we genuinely cannot tell, we return riskLevel="UNKNOWN" so the app
//     waits for user input rather than guessing.
//   * Caller text is supporting evidence — it can RAISE the risk (e.g. the words
//     "not breathing") but the engine never invents vitals.

import type {
  ConfidencePoint,
  EvidenceObject,
  RiskAssessment,
  RiskLevel,
} from "../components/types";

// Audio level (0..100 RMS) above which we treat the environment as "loud" —
// consistent with a shout, impact, or crash.
const LOUD_AUDIO_THRESHOLD = 70;

// Keywords in caller text that indicate a definite medical emergency.
const CRITICAL_MEDICAL_KEYWORDS = [
  "collapsed",
  "not breathing",
  "no pulse",
  "unconscious",
  "unresponsive",
  "cardiac",
  "heart attack",
  "choking",
];

const HIGH_MEDICAL_KEYWORDS = [
  "chest pain",
  "bleeding",
  "seizure",
  "stroke",
  "fell",
  "fall",
  "injured",
  "hurt",
];

function textContainsAny(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k));
}

// Numeric rank so we can take the most severe of several fired rules.
const RISK_RANK: Record<RiskLevel, number> = {
  UNKNOWN: 0,
  LOW: 1,
  MODERATE: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

// Action-oriented headline per emergency type — shown the instant the Risk
// Engine flags an event, BEFORE Gemini is ever called (point 1 of the spec).
function headlineFor(emergencyType: string): string {
  const t = emergencyType.toLowerCase();
  if (t.includes("vehicle")) return "⚠ Possible Collision Detected";
  if (t.includes("fall") || t.includes("impact"))
    return "⚠ Possible Fall / Impact Detected";
  if (t.includes("medical") || t.includes("cardiac"))
    return "⚠ Possible Medical Emergency";
  if (t.includes("loud")) return "⚠ Loud Event Detected";
  return "Monitoring — no emergency detected";
}

/**
 * Assess risk from fused sensor evidence plus optional caller text.
 *
 * This is the DETERMINISTIC, instant decision. It never calls AI. It also
 * builds a progressive `signals[]` trail so the UI can animate a continuously
 * climbing confidence score with a human-readable reason for each jump
 * (point 4 of the spec).
 */
export function assessRisk(
  evidence: EvidenceObject,
  text = ""
): RiskAssessment {
  const rulesFired: string[] = [];
  // Progressive-confidence trail: each meaningful evidence change pushes a
  // (value, reason) point so the score visibly evolves rather than snapping.
  const signals: ConfidencePoint[] = [];
  let riskLevel: RiskLevel = "UNKNOWN";
  let emergencyType = "Unknown";
  let confidence = 0;

  // Record a confidence jump only when it actually raises the score, so the
  // trail reads as a monotonic, sensible climb.
  const bump = (to: number, reason: string) => {
    const clamped = Math.max(0, Math.min(1, to));
    if (clamped > confidence + 1e-6) {
      confidence = clamped;
      signals.push({
        value: Math.round(clamped * 100),
        reason,
        at: Date.now(),
      });
    }
  };

  const loudAudio =
    evidence.audioLevel !== null && evidence.audioLevel > LOUD_AUDIO_THRESHOLD;

  // ── Progressive seed signals (make the score feel alive from frame 1) ──────
  // A motion spike alone is an early, low-confidence hint; a loud noise nudges
  // it higher. These mirror the spec's "25% → 48%" opening beats.
  if (evidence.motionAnomaly === true) {
    bump(0.25, "Motion spike detected");
  }
  if (loudAudio) {
    bump(0.48, "Loud noise detected");
  }

  // ── Rule 1: motion spike + loud audio → CRITICAL (possible fall/impact) ─────
  // A sharp acceleration spike combined with a loud sound is the classic
  // signature of a fall or impact event.
  if (evidence.motionAnomaly === true && loudAudio) {
    riskLevel = maxRisk(riskLevel, "CRITICAL");
    emergencyType = "Possible fall/impact";
    bump(0.7, "Motion spike + loud audio → critical pattern");
    rulesFired.push(
      "Motion spike + loud audio (> 70 RMS) → CRITICAL (possible fall/impact)"
    );
  }

  // ── Rule 2: stationary device + recent motion spike → HIGH ─────────────────
  // Someone who fell and is now not moving: a spike followed by stillness.
  if (evidence.motionAnomaly === true && evidence.deviceStationary === true) {
    riskLevel = maxRisk(riskLevel, "HIGH");
    if (emergencyType === "Unknown") emergencyType = "Possible fall — now stationary";
    bump(0.72, "Device stationary after impact (victim not moving)");
    rulesFired.push(
      "Motion spike then device stationary → HIGH (possible fall, now still)"
    );
  }

  // ── Rule 3: high GPS speed + motion spike → CRITICAL (possible vehicle) ─────
  // High travel speed plus an impact spike suggests a vehicle incident. NOTE:
  // true crash detection needs a native SDK (labelled Future Work); this is a
  // best-effort heuristic from browser GPS + motion only.
  if (
    evidence.motionAnomaly === true &&
    evidence.speedKmh !== null &&
    evidence.speedKmh > 40
  ) {
    riskLevel = maxRisk(riskLevel, "CRITICAL");
    emergencyType = "Possible vehicle incident";
    bump(0.68, "Impact at speed > 40 km/h → collision pattern");
    rulesFired.push(
      "Impact spike at speed > 40 km/h → CRITICAL (possible vehicle incident)"
    );
  }

  // ── Rule 4: caller text contains critical medical keywords → CRITICAL ───────
  const criticalHits = textContainsAny(text, CRITICAL_MEDICAL_KEYWORDS);
  if (criticalHits.length > 0) {
    riskLevel = maxRisk(riskLevel, "CRITICAL");
    emergencyType = "Medical";
    bump(0.8, `Caller reported ${criticalHits.map((h) => `"${h}"`).join(", ")}`);
    rulesFired.push(
      `Caller mentioned ${criticalHits
        .map((h) => `"${h}"`)
        .join(", ")} → CRITICAL (medical)`
    );
  }

  // ── Rule 5: caller text contains high-severity keywords → HIGH ─────────────
  const highHits = textContainsAny(text, HIGH_MEDICAL_KEYWORDS);
  if (highHits.length > 0) {
    riskLevel = maxRisk(riskLevel, "HIGH");
    if (emergencyType === "Unknown") emergencyType = "Medical";
    bump(0.6, `Caller reported ${highHits.map((h) => `"${h}"`).join(", ")}`);
    rulesFired.push(
      `Caller mentioned ${highHits
        .map((h) => `"${h}"`)
        .join(", ")} → HIGH (medical)`
    );
  }

  // ── Rule 6: loud audio alone (no motion) → MODERATE ────────────────────────
  if (loudAudio && evidence.motionAnomaly !== true && riskLevel === "UNKNOWN") {
    riskLevel = "MODERATE";
    emergencyType = "Loud event detected";
    bump(0.35, "Loud audio with no motion → moderate");
    rulesFired.push("Loud audio (> 70 RMS) with no motion → MODERATE");
  }

  // ── Rule 7: battery low while an emergency is suspected → note it ───────────
  if (evidence.batteryLow === true && riskLevel !== "UNKNOWN") {
    bump(confidence + 0.02, "Device battery low — act before power is lost");
    rulesFired.push("Device battery low (< 15%) — act before power is lost");
  }

  // ── Confidence boost: live GPS gives the dispatcher a real position ─────────
  if (evidence.locationAvailable && riskLevel !== "UNKNOWN") {
    bump(confidence + 0.2, "Live GPS location available → position confirmed");
    rulesFired.push("Live GPS location available → location confidence high");
  }

  // ── Determine what evidence is still missing (to explain uncertainty) ──────
  const missingEvidence: string[] = [];
  if (evidence.motionAnomaly === null) missingEvidence.push("motion data");
  if (!evidence.locationAvailable) missingEvidence.push("GPS location");
  if (evidence.audioLevel === null) missingEvidence.push("audio level");
  // Vitals always need explicit confirmation from the caller.
  missingEvidence.push("victim breathing/pulse/consciousness (needs confirmation)");

  // If nothing fired at all, we honestly report UNKNOWN and wait for input.
  if (riskLevel === "UNKNOWN") {
    rulesFired.push(
      "No rule triggered with available evidence → UNKNOWN (awaiting user input)"
    );
  }

  return {
    riskLevel,
    emergencyType,
    confidence: Math.max(0, Math.min(1, confidence)),
    missingEvidence,
    rulesFired,
    headline: headlineFor(emergencyType),
    signals,
  };
}

/**
 * Silence / stillness escalation (point 2 of the spec).
 *
 * In an event-driven emergency system, a *lack* of response is itself strong
 * evidence: a victim who cannot answer a prompt or move the device is more
 * likely to be severely incapacitated (e.g. unconscious). This helper takes an
 * existing assessment and returns a NEW one with the confidence bumped and a
 * progressive signal appended — used when an auto-progression countdown expires
 * with no user input.
 *
 * It never *lowers* confidence and never invents vitals; it simply encodes the
 * deterministic "assume the worst on silence" safety policy.
 */
export function escalateOnSilence(
  risk: RiskAssessment,
  reason = "No response — assuming victim is unconscious"
): RiskAssessment {
  const newConfidence = Math.min(1, Math.max(risk.confidence, 0.88));
  const signals = [...(risk.signals ?? [])];
  if (newConfidence > risk.confidence + 1e-6) {
    signals.push({
      value: Math.round(newConfidence * 100),
      reason,
      at: Date.now(),
    });
  }
  return {
    ...risk,
    // Silence on a flagged emergency pushes us to at least HIGH severity.
    riskLevel: maxRisk(risk.riskLevel, "HIGH"),
    confidence: newConfidence,
    rulesFired: [
      ...risk.rulesFired,
      "No response within time-to-respond window → escalated (assume worst)",
    ],
    signals,
  };
}

/**
 * Convert the camelCase RiskAssessment into the snake_case shape the backend
 * /sensor-analyze endpoint expects.
 */
export function riskToBackend(risk: RiskAssessment): Record<string, unknown> {
  return {
    risk_level: risk.riskLevel,
    emergency_type: risk.emergencyType,
    confidence: risk.confidence,
    missing_evidence: risk.missingEvidence,
    rules_fired: risk.rulesFired,
    headline: risk.headline ?? null,
  };
}
