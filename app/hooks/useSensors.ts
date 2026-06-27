// app/hooks/useSensors.ts
//
// React hook that reads every sensor that ACTUALLY works in a browser and
// reports an honest availability status for each one. Nothing here fakes a live
// reading: a value is only "live" when it came from real hardware. Simulated
// values are injected separately by Demo Mode (see applyDemoSpike) and always
// tagged in `demoKeys` so the UI can show an orange DEMO badge.
//
// Browser reality (Chrome):
//   GPS          — navigator.geolocation                 (live, one-time prompt)
//   Motion/accel — DeviceMotionEvent                     (live on Chrome/Android)
//   Audio level  — getUserMedia + AnalyserNode RMS       (live, one-time prompt)
//   Battery      — navigator.getBattery()                (Chrome only, no prompt)

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  RawSensors,
  SensorAvailability,
  SensorKey,
  SensorReading,
} from "../components/types";

const EMPTY_RAW: RawSensors = {
  gpsAvailable: false,
  latitude: null,
  longitude: null,
  speedKmh: null,
  motionAvailable: false,
  accelMagnitudeG: null,
  audioAvailable: false,
  audioLevel: null,
  batteryAvailable: false,
  batteryLevel: null,
  demoKeys: [],
};

// Permission status per sensor, surfaced so the UI can prompt sensibly.
export type PermissionState = "idle" | "requesting" | "granted" | "denied";

export interface UseSensorsResult {
  raw: RawSensors;
  readings: SensorReading[];
  // Begin requesting live permissions for GPS, motion, audio, battery.
  requestPermissions: () => Promise<void>;
  // Inject a demo accelerometer spike + loud audio (clearly DEMO-tagged).
  applyDemoSpike: (opts?: { accelG?: number; audio?: number }) => void;
  // Clear any demo overrides, returning to purely-live readings.
  clearDemo: () => void;
}

const GRAVITY = 9.80665;

export function useSensors(): UseSensorsResult {
  const [raw, setRaw] = useState<RawSensors>(EMPTY_RAW);

  // Demo overrides held in a ref so live updates don't clobber them.
  const demoRef = useRef<{ accelG: number | null; audio: number | null }>({
    accelG: null,
    audio: null,
  });

  // Audio analysis refs.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioRafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Demo helpers ───────────────────────────────────────────────────────────
  const applyDemoSpike = useCallback(
    (opts?: { accelG?: number; audio?: number }) => {
      const accelG = opts?.accelG ?? 4.2;
      const audio = opts?.audio ?? 78;
      demoRef.current = { accelG, audio };
      setRaw((prev) => {
        const demoKeys = Array.from(
          new Set<SensorKey>([...prev.demoKeys, "motion", "audio"])
        );
        return {
          ...prev,
          motionAvailable: true,
          accelMagnitudeG: accelG,
          audioAvailable: true,
          audioLevel: audio,
          demoKeys,
        };
      });
    },
    []
  );

  const clearDemo = useCallback(() => {
    demoRef.current = { accelG: null, audio: null };
    setRaw((prev) => ({
      ...prev,
      demoKeys: prev.demoKeys.filter((k) => k !== "motion" && k !== "audio"),
    }));
  }, []);

  // ── GPS ──────────────────────────────────────────────────────────────────
  const startGps = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.watchPosition(
      (pos) => {
        const speedMs = pos.coords.speed; // m/s or null
        const speedKmh = speedMs !== null && !Number.isNaN(speedMs)
          ? speedMs * 3.6
          : 0;
        setRaw((prev) => ({
          ...prev,
          gpsAvailable: true,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          speedKmh,
        }));
      },
      () => {
        setRaw((prev) => ({ ...prev, gpsAvailable: false }));
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  }, []);

  // ── Motion / accelerometer ─────────────────────────────────────────────────
  const startMotion = useCallback(async () => {
    if (typeof window === "undefined" || typeof DeviceMotionEvent === "undefined")
      return;

    // iOS 13+ requires an explicit permission request gesture.
    const anyDM = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    try {
      if (typeof anyDM.requestPermission === "function") {
        const res = await anyDM.requestPermission();
        if (res !== "granted") return;
      }
    } catch {
      // Some browsers throw if not in a user gesture — ignore and try listening.
    }

    const handler = (e: DeviceMotionEvent) => {
      // Skip live updates while a demo spike is active so we don't overwrite it.
      if (demoRef.current.accelG !== null) return;
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const x = acc.x ?? 0;
      const y = acc.y ?? 0;
      const z = acc.z ?? 0;
      const magnitudeG = Math.sqrt(x * x + y * y + z * z) / GRAVITY;
      setRaw((prev) => ({
        ...prev,
        motionAvailable: true,
        accelMagnitudeG: magnitudeG,
      }));
    };

    window.addEventListener("devicemotion", handler);
    // Mark as available even before the first event so the badge shows "live".
    setRaw((prev) => ({ ...prev, motionAvailable: true }));
  }, []);

  // ── Audio level (RMS) ───────────────────────────────────────────────────────
  const startAudio = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    )
      return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        // Skip live updates while a demo audio value is active.
        if (demoRef.current.audio === null && analyserRef.current) {
          analyserRef.current.getByteTimeDomainData(data);
          let sumSq = 0;
          for (let i = 0; i < data.length; i += 1) {
            const v = (data[i] - 128) / 128; // -1..1
            sumSq += v * v;
          }
          const rms = Math.sqrt(sumSq / data.length); // 0..1
          const level = Math.min(100, Math.round(rms * 300)); // scale to 0..100
          setRaw((prev) => ({
            ...prev,
            audioAvailable: true,
            audioLevel: level,
          }));
        }
        audioRafRef.current = requestAnimationFrame(tick);
      };
      setRaw((prev) => ({ ...prev, audioAvailable: true }));
      tick();
    } catch {
      setRaw((prev) => ({ ...prev, audioAvailable: false }));
    }
  }, []);

  // ── Battery ────────────────────────────────────────────────────────────────
  const startBattery = useCallback(async () => {
    const nav = navigator as unknown as {
      getBattery?: () => Promise<{
        level: number;
        addEventListener: (t: string, cb: () => void) => void;
      }>;
    };
    if (typeof nav.getBattery !== "function") return;
    try {
      const battery = await nav.getBattery();
      const update = () =>
        setRaw((prev) => ({
          ...prev,
          batteryAvailable: true,
          batteryLevel: battery.level,
        }));
      update();
      battery.addEventListener("levelchange", update);
    } catch {
      // ignore
    }
  }, []);

  const requestPermissions = useCallback(async () => {
    startGps();
    await startMotion();
    await startAudio();
    await startBattery();
  }, [startGps, startMotion, startAudio, startBattery]);

  // Cleanup audio on unmount.
  useEffect(() => {
    return () => {
      if (audioRafRef.current) cancelAnimationFrame(audioRafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  // ── Derive display readings ────────────────────────────────────────────────
  const readings = buildReadings(raw);

  return { raw, readings, requestPermissions, applyDemoSpike, clearDemo };
}

// Turn raw readings into UI-friendly SensorReading rows with honest badges.
function buildReadings(raw: RawSensors): SensorReading[] {
  const isDemo = (k: SensorKey): boolean => raw.demoKeys.includes(k);

  const availability = (
    k: SensorKey,
    live: boolean
  ): SensorAvailability => {
    if (isDemo(k)) return "demo";
    return live ? "live" : "unavailable";
  };

  return [
    {
      key: "gps",
      label: "GPS",
      icon: "📍",
      availability: availability("gps", raw.gpsAvailable),
      value:
        raw.gpsAvailable && raw.speedKmh !== null
          ? `${raw.speedKmh.toFixed(0)} km/h`
          : raw.gpsAvailable
          ? "located"
          : "—",
    },
    {
      key: "motion",
      label: "Motion",
      icon: "📱",
      availability: availability("motion", raw.motionAvailable),
      value:
        raw.accelMagnitudeG !== null
          ? `${raw.accelMagnitudeG.toFixed(1)} g`
          : "—",
    },
    {
      key: "audio",
      label: "Audio",
      icon: "🎤",
      availability: availability("audio", raw.audioAvailable),
      value: raw.audioLevel !== null ? `${raw.audioLevel} RMS` : "—",
    },
    {
      key: "battery",
      label: "Battery",
      icon: "🔋",
      availability: availability("battery", raw.batteryAvailable),
      value:
        raw.batteryLevel !== null
          ? `${Math.round(raw.batteryLevel * 100)}%`
          : "—",
    },
  ];
}
