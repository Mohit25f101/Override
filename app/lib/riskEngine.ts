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

import type { EvidenceObject, RiskAssessment, RiskLevel } from "../components/types";

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

/**
 * Assess risk from fused sensor evidence plus optional caller text.
 */
export function assessRisk(
  evidence: EvidenceObject,
  text = ""
): RiskAssessment {
  const rulesFired: string[] = [];
  let riskLevel: RiskLevel = "UNKNOWN";
  let emergencyType = "Unknown";
  let confidence = 0;

  const loudAudio =
    evidence.audioLevel !== null && evidence.audioLevel > LOUD_AUDIO_THRESHOLD;

  // ── Rule 1: motion spike + loud audio → CRITICAL (possible fall/impact) ─────
  // A sharp acceleration spike combined with a loud sound is the classic
  // signature of a fall or impact event.
  if (evidence.motionAnomaly === true && loudAudio) {
    riskLevel = maxRisk(riskLevel, "CRITICAL");
    emergencyType = "Possible fall/impact";
    confidence = Math.max(confidence, 0.7);
    rulesFired.push(
      "Motion spike + loud audio (> 70 RMS) → CRITICAL (possible fall/impact)"
    );
  }

  // ── Rule 2: stationary device + recent motion spike → HIGH ─────────────────
  // Someone who fell and is now not moving: a spike followed by stillness.
  if (evidence.motionAnomaly === true && evidence.deviceStationary === true) {
    riskLevel = maxRisk(riskLevel, "HIGH");
    if (emergencyType === "Unknown") emergencyType = "Possible fall — now stationary";
    confidence = Math.max(confidence, 0.55);
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
    confidence = Math.max(confidence, 0.65);
    rulesFired.push(
      "Impact spike at speed > 40 km/h → CRITICAL (possible vehicle incident)"
    );
  }

  // ── Rule 4: caller text contains critical medical keywords → CRITICAL ───────
  const criticalHits = textContainsAny(text, CRITICAL_MEDICAL_KEYWORDS);
  if (criticalHits.length > 0) {
    riskLevel = maxRisk(riskLevel, "CRITICAL");
    emergencyType = "Medical";
    confidence = Math.max(confidence, 0.8);
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
    confidence = Math.max(confidence, 0.6);
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
    confidence = Math.max(confidence, 0.35);
    rulesFired.push("Loud audio (> 70 RMS) with no motion → MODERATE");
  }

  // ── Rule 7: battery low while an emergency is suspected → note it ───────────
  if (evidence.batteryLow === true && riskLevel !== "UNKNOWN") {
    confidence = Math.min(1, confidence + 0.02);
    rulesFired.push("Device battery low (< 15%) — act before power is lost");
  }

  // ── Confidence boost: live GPS gives the dispatcher a real position ─────────
  if (evidence.locationAvailable && riskLevel !== "UNKNOWN") {
    confidence = Math.min(1, confidence + 0.2);
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
  };
}
