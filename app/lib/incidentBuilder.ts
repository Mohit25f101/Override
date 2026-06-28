import type { EvidenceItem, IncidentContext, RiskLevel } from "../components/types";

/**
 * Incident Builder groups related evidence into a cohesive Incident object
 * before passing it to the Risk Engine.
 */
export function buildIncident(evidence: EvidenceItem[], existingIncident?: IncidentContext | null): IncidentContext | null {
  if (evidence.length === 0) return existingIncident || null;

  // For a simple hackathon scope, we merge all evidence into a single active incident.
  const now = Date.now();
  const incidentId = existingIncident?.incidentId || `INC-${now}`;
  const startTime = existingIncident?.startTime || now;

  // De-duplicate evidence by type, keeping the latest one
  const evidenceMap = new Map<string, EvidenceItem>();
  if (existingIncident) {
    existingIncident.evidence.forEach(e => evidenceMap.set(e.type, e));
  }
  evidence.forEach(e => evidenceMap.set(e.type, e));

  const mergedEvidence = Array.from(evidenceMap.values());

  return {
    incidentId,
    type: existingIncident?.type || "unknown", // Risk Engine will update this
    startTime,
    evidence: mergedEvidence,
    severity: existingIncident?.severity || "UNKNOWN",
    confidence: existingIncident?.confidence || 0,
    confidenceBand: existingIncident?.confidenceBand || "Monitoring",
  };
}
