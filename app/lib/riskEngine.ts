import type {
  ConfidencePoint,
  IncidentContext,
  RiskAssessment,
  RiskLevel,
  EvidenceItem,
} from "../components/types";

const CRITICAL_MEDICAL_KEYWORDS = [
  "collapsed", "not breathing", "no pulse", "unconscious",
  "unresponsive", "cardiac", "heart attack", "choking",
];

const HIGH_MEDICAL_KEYWORDS = [
  "chest pain", "bleeding", "seizure", "stroke",
  "fell", "fall", "injured", "hurt",
];

function textContainsAny(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k));
}

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

function headlineFor(emergencyType: string): string {
  const t = emergencyType.toLowerCase();
  if (t.includes("vehicle") || t.includes("collision")) return "⚠ Possible Collision Detected";
  if (t.includes("fall") || t.includes("impact")) return "⚠ Possible Fall / Impact Detected";
  if (t.includes("medical") || t.includes("cardiac")) return "⚠ Possible Medical Emergency";
  if (t.includes("loud")) return "⚠ Loud Event Detected";
  return "Monitoring — no emergency detected";
}

export function assessRisk(
  incident: IncidentContext,
  text = ""
): RiskAssessment {
  const rulesFired: string[] = [];
  const signals: ConfidencePoint[] = [];
  let riskLevel: RiskLevel = incident.severity;
  let emergencyType = incident.type;
  let confidence = incident.confidence;

  const bump = (amount: number, reason: string) => {
    const newConf = Math.max(0, Math.min(1, confidence + amount));
    if (newConf > confidence + 1e-6) {
      confidence = newConf;
      signals.push({
        value: Math.round(confidence * 100),
        reason,
        at: Date.now(),
      });
    }
  };

  const getEvidence = (type: string) => incident.evidence.find(e => e.type === type);
  
  const impact = getEvidence("impact");
  const loudNoise = getEvidence("loud_noise");
  const suddenStop = getEvidence("sudden_stop");
  const inactivity = getEvidence("prolonged_inactivity");
  const lowBattery = getEvidence("low_battery");

  // Base confidence from evidence
  if (impact) bump(0.25, `Motion spike detected (${impact.id})`);
  if (loudNoise) bump(0.23, `Loud noise detected (${loudNoise.id})`);

  // Rule 1: Impact + Loud Audio
  if (impact && loudNoise) {
    riskLevel = maxRisk(riskLevel, "CRITICAL");
    emergencyType = "Possible fall/impact";
    bump(0.22, `Impact + Loud audio → critical pattern`);
    rulesFired.push(`Impact + Loud audio → CRITICAL (possible fall/impact)`);
  }

  // Rule 2: Sudden Stop + Impact
  if (suddenStop && impact) {
    riskLevel = maxRisk(riskLevel, "CRITICAL");
    emergencyType = "Possible vehicle collision";
    bump(0.40, `Sudden stop + impact → collision pattern`);
    rulesFired.push(`Sudden stop + impact → CRITICAL (vehicle collision)`);
  }

  // Rule 3: Prolonged Inactivity after impact
  if (impact && inactivity) {
    riskLevel = maxRisk(riskLevel, "HIGH");
    if (emergencyType === "unknown") emergencyType = "Possible fall — now stationary";
    bump(0.20, `Device stationary after impact (${inactivity.id})`);
    rulesFired.push(`Impact then stationary → HIGH`);
  }

  // Caller text rules
  const criticalHits = textContainsAny(text, CRITICAL_MEDICAL_KEYWORDS);
  if (criticalHits.length > 0) {
    riskLevel = maxRisk(riskLevel, "CRITICAL");
    emergencyType = "Medical";
    bump(0.8, `Caller reported ${criticalHits.join(", ")}`);
    rulesFired.push(`Caller mentioned ${criticalHits.join(", ")} → CRITICAL`);
  }

  const highHits = textContainsAny(text, HIGH_MEDICAL_KEYWORDS);
  if (highHits.length > 0 && criticalHits.length === 0) {
    riskLevel = maxRisk(riskLevel, "HIGH");
    if (emergencyType === "unknown") emergencyType = "Medical";
    bump(0.6, `Caller reported ${highHits.join(", ")}`);
    rulesFired.push(`Caller mentioned ${highHits.join(", ")} → HIGH`);
  }

  if (lowBattery && riskLevel !== "UNKNOWN") {
    bump(0.02, `Battery low (${lowBattery.id}) — act quickly`);
    rulesFired.push(`Device battery low — act before power is lost`);
  }

  // Time-based decay (if incident is old and confidence is low)
  const ageMs = Date.now() - incident.startTime;
  if (ageMs > 10000 && confidence < 0.6 && riskLevel !== "CRITICAL") {
    // Decay by 5% every 10 seconds if nothing else happened
    const decayAmount = 0.05 * Math.floor(ageMs / 10000);
    confidence = Math.max(0, confidence - decayAmount);
    if (decayAmount > 0 && signals.length === 0 || (signals[signals.length - 1].reason !== "Confidence decay over time")) {
       signals.push({ value: Math.round(confidence * 100), reason: "Confidence decay over time", at: Date.now() });
    }
  }

  if (riskLevel === "UNKNOWN") {
    rulesFired.push("No rule triggered with available evidence → UNKNOWN");
  }

  return {
    riskLevel,
    emergencyType,
    confidence,
    missingEvidence: [],
    rulesFired,
    headline: headlineFor(emergencyType),
    signals,
  };
}

export function escalateOnSilence(
  risk: RiskAssessment,
  reason = "No response — assuming victim is unconscious"
): RiskAssessment {
  const newConfidence = Math.min(1, Math.max(risk.confidence, 0.88));
  const signals = [...(risk.signals ?? [])];
  if (newConfidence > risk.confidence + 1e-6) {
    signals.push({ value: Math.round(newConfidence * 100), reason, at: Date.now() });
  }
  return {
    ...risk,
    riskLevel: maxRisk(risk.riskLevel, "HIGH"),
    confidence: newConfidence,
    rulesFired: [...risk.rulesFired, "No response within time-to-respond window → escalated"],
    signals,
  };
}

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
