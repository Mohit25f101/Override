import type { RawSensors, EvidenceItem } from "../components/types";

// Thresholds
const MOTION_SPIKE_G = 2.5;
const LOUD_AUDIO_RMS = 70;
const STATIONARY_SPEED_KMH = 3;
const BATTERY_LOW = 0.15;

/**
 * The Evidence Engine converts a rolling window of raw sensor readings
 * into structured, typed EvidenceItem facts.
 */
export function analyzeEvidence(history: RawSensors[]): EvidenceItem[] {
  if (history.length === 0) return [];
  
  const latest = history[history.length - 1];
  const items: EvidenceItem[] = [];

  // 1. Motion Spike (High Impact)
  // Check if any reading in the window crossed the threshold.
  const hasSpike = history.some(
    (h) => h.motionAvailable && h.accelMagnitudeG !== null && h.accelMagnitudeG >= MOTION_SPIKE_G
  );
  if (hasSpike) {
    items.push({
      id: `EV-MOTION-${Date.now()}`,
      type: "impact",
      source: "accelerometer",
      confidence: 0.95,
      timestamp: Date.now(),
      details: {
        peakG: Math.max(...history.map(h => h.accelMagnitudeG ?? 0))
      }
    });
  }

  // 2. Loud Audio
  const isLoud = history.some(
    (h) => h.audioAvailable && h.audioLevel !== null && h.audioLevel >= LOUD_AUDIO_RMS
  );
  if (isLoud) {
    items.push({
      id: `EV-AUDIO-${Date.now()}`,
      type: "loud_noise",
      source: "microphone",
      confidence: 0.90,
      timestamp: Date.now(),
      details: {
        peakRMS: Math.max(...history.map(h => h.audioLevel ?? 0))
      }
    });
  }

  // 3. Sudden Stop
  // Look for a high speed early in the window, dropping to near-zero.
  if (history.length > 5 && latest.gpsAvailable) {
    const earlySpeed = history[0].speedKmh ?? 0;
    const latestSpeed = latest.speedKmh ?? 0;
    if (earlySpeed > 30 && latestSpeed < STATIONARY_SPEED_KMH) {
      items.push({
        id: `EV-STOP-${Date.now()}`,
        type: "sudden_stop",
        source: "gps",
        confidence: 0.85,
        timestamp: Date.now(),
        details: { fromSpeed: earlySpeed, toSpeed: latestSpeed }
      });
    }
  }

  // 4. Prolonged Inactivity
  // If there was an impact in this window, and the *latest* reading shows no movement.
  // We infer "no movement" from near-zero speed.
  if (hasSpike && latest.gpsAvailable && (latest.speedKmh ?? 0) < STATIONARY_SPEED_KMH) {
    items.push({
      id: `EV-INACTIVE-${Date.now()}`,
      type: "prolonged_inactivity",
      source: "gps",
      confidence: 0.88,
      timestamp: Date.now(),
      details: { currentSpeed: latest.speedKmh }
    });
  }

  // 5. Low Battery
  if (latest.batteryAvailable && latest.batteryLevel !== null && latest.batteryLevel < BATTERY_LOW) {
    items.push({
      id: `EV-BATTERY-${Date.now()}`,
      type: "low_battery",
      source: "battery",
      confidence: 1.0,
      timestamp: Date.now(),
      details: { level: latest.batteryLevel }
    });
  }

  return items;
}
