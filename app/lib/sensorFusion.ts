// app/lib/sensorFusion.ts
//
// Sensor Fusion module.
//
// Takes the raw, heterogeneous readings produced by the useSensors hook and
// distils them into ONE structured EvidenceObject. This is the only sensor
// representation that ever leaves the device — raw sensor objects are NEVER
// passed to the Risk Engine or to Gemini. Fusion is where we:
//
//   * decide what counts as a "motion anomaly" (an acceleration spike),
//   * normalise GPS speed and audio level,
//   * flag a low battery,
//   * decide whether the device looks stationary,
//   * and record exactly which sensors were real vs. simulated (demo).
//
// Everything here is transparent and rule-based — no ML, no black boxes.

import type { EvidenceObject, RawSensors } from "../components/types";

// Threshold (in g) above which a single acceleration reading is treated as an
// impact / fall spike. Earth gravity is ~1g at rest; a hard fall or impact
// typically produces a transient well above 2.5–3g. We use 2.5g.
export const MOTION_SPIKE_THRESHOLD_G = 2.5;

// Below this speed (km/h) we consider the device "not moving in a vehicle".
export const STATIONARY_SPEED_KMH = 3;

// Battery fraction below which we flag batteryLow.
export const BATTERY_LOW_FRACTION = 0.15;

/**
 * Fuse raw sensor readings into a single EvidenceObject.
 *
 * Null is used deliberately to mean "this sensor produced no usable data", so
 * downstream consumers (Risk Engine, Gemini prompt builder) can distinguish
 * "no evidence" from "evidence that something is false".
 */
export function fuseSensors(raw: RawSensors): EvidenceObject {
  const sourcesUsed: string[] = [];
  const demoSources: string[] = [...raw.demoKeys];

  // ── Motion ───────────────────────────────────────────────────────────────
  let motionAnomaly: boolean | null = null;
  if (raw.motionAvailable && raw.accelMagnitudeG !== null) {
    motionAnomaly = raw.accelMagnitudeG >= MOTION_SPIKE_THRESHOLD_G;
    if (!raw.demoKeys.includes("motion")) sourcesUsed.push("motion");
  }

  // ── GPS / location & speed ─────────────────────────────────────────────────
  const locationAvailable = raw.gpsAvailable;
  let speedKmh: number | null = null;
  if (raw.gpsAvailable) {
    speedKmh = raw.speedKmh ?? 0;
    if (!raw.demoKeys.includes("gps")) sourcesUsed.push("gps");
  }

  // ── Audio level ────────────────────────────────────────────────────────────
  let audioLevel: number | null = null;
  if (raw.audioAvailable && raw.audioLevel !== null) {
    // Clamp to the 0..100 contract.
    audioLevel = Math.max(0, Math.min(100, raw.audioLevel));
    if (!raw.demoKeys.includes("audio")) sourcesUsed.push("audio");
  }

  // ── Battery ────────────────────────────────────────────────────────────────
  let batteryLow: boolean | null = null;
  if (raw.batteryAvailable && raw.batteryLevel !== null) {
    batteryLow = raw.batteryLevel < BATTERY_LOW_FRACTION;
    if (!raw.demoKeys.includes("battery")) sourcesUsed.push("battery");
  }

  // ── Device stationary ──────────────────────────────────────────────────────
  // We infer "stationary" from GPS speed when available: a near-zero speed means
  // the device is not travelling. (A true >30s no-motion detector would need a
  // rolling accelerometer buffer; speed is a robust, honest proxy for the demo.)
  let deviceStationary: boolean | null = null;
  if (speedKmh !== null) {
    deviceStationary = speedKmh < STATIONARY_SPEED_KMH;
  }

  return {
    motionAnomaly,
    locationAvailable,
    speedKmh,
    audioLevel,
    batteryLow,
    deviceStationary,
    timestamp: Date.now(),
    sourcesUsed,
    demoSources,
  };
}

/**
 * Convert the camelCase EvidenceObject into the snake_case shape the backend
 * /sensor-analyze endpoint expects. Kept here so the wire contract lives next
 * to the type that produces it.
 */
export function evidenceToBackend(ev: EvidenceObject): Record<string, unknown> {
  return {
    motion_anomaly: ev.motionAnomaly,
    location_available: ev.locationAvailable,
    speed_kmh: ev.speedKmh,
    audio_level: ev.audioLevel,
    battery_low: ev.batteryLow,
    device_stationary: ev.deviceStationary,
    timestamp: ev.timestamp,
    sources_used: ev.sourcesUsed,
    demo_sources: ev.demoSources,
  };
}
