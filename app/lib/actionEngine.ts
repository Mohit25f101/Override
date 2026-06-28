import type { ActionDef, IncidentContext } from "../components/types";

export function generateActions(
  result: Record<string, any> | null,
  incident: IncidentContext
): ActionDef[] {
  const actions: ActionDef[] = [];

  // If CVL confirmed a critical arrest (no breathing/pulse), highest priority is CPR
  const isArrest = result?.victim_breathing === false || result?.victim_pulse_present === false;
  
  if (isArrest) {
    actions.push({
      priority: 1,
      type: "CPR",
      label: "Begin CPR Immediately",
      reason: ["No breathing detected", "No pulse detected", "Life-threatening emergency"],
      blocking: false,
      automatic: false,
      requiresConfirmation: false,
    });
  }

  // Next priority: Call Emergency Services (if confidence > 60% or critical severity)
  if (incident.severity === "CRITICAL" || incident.severity === "HIGH" || incident.confidence > 0.6) {
    actions.push({
      priority: isArrest ? 2 : 1,
      type: "CALL",
      label: "Call Emergency Services (112)",
      reason: [
        `${incident.severity} severity`,
        `Confidence > ${Math.round(incident.confidence * 100)}%`,
        "CVL Approved"
      ],
      blocking: false,
      automatic: false, // In a real app this might be true if confidence > 95%
      requiresConfirmation: true,
    });
  }

  // Always offer location sharing if location is known
  // (We check raw sensors in the frontend for actual coords, but here we just queue the action)
  actions.push({
    priority: 3,
    type: "LOCATION",
    label: "Share Location with Dispatch",
    reason: ["GPS location available", "Accelerates emergency response time"],
    blocking: false,
    automatic: true, // We could automatically append location to the payload
    requiresConfirmation: false,
  });

  if (actions.length === 0) {
    actions.push({
      priority: 1,
      type: "MONITOR",
      label: "Keep Monitoring",
      reason: ["No immediate life-threat detected", "Awaiting more sensor data"],
      blocking: false,
      automatic: true,
      requiresConfirmation: false,
    });
  }

  // Sort by priority (lowest number first)
  actions.sort((a, b) => a.priority - b.priority);

  return actions;
}
