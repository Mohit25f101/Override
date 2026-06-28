"use client";

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { LiveInfo, RiskLevel, SensorReading } from "./types";
import { SensorStatusRow } from "./SensorGrid";

interface LiveInfoCardProps {
  // Accumulated live info from the SSE stream.
  info: LiveInfo;
  // NEW — risk level surfaced from the in-browser Risk Engine (or the SSE
  // stream). Drives the colour-coded badge in the new top section.
  riskLevel?: RiskLevel;
  // NEW — current sensor readings, shown as a compact status row when present.
  sensors?: SensorReading[];
}

// Threshold (percent) above which the CVL is confident enough to PROCEED.
const PROCEED_THRESHOLD = 85;

// Colour-coded pill classes per risk level.
function riskBadgeClasses(level: RiskLevel | undefined): string {
  switch (level) {
    case "CRITICAL":
      return "bg-red-500/15 text-red-300 border-red-500/50";
    case "HIGH":
      return "bg-orange-500/15 text-orange-300 border-orange-500/50";
    case "MODERATE":
      return "bg-yellow-500/15 text-yellow-300 border-yellow-500/50";
    case "LOW":
      return "bg-green-500/15 text-green-300 border-green-500/50";
    case "UNKNOWN":
    default:
      return "bg-gray-500/15 text-gray-300 border-gray-500/40";
  }
}

// Colour-coded pill classes per CVL band.
function bandClasses(band: string | undefined): string {
  switch (band) {
    case "PROCEED":
      return "bg-green-500/15 text-green-300 border-green-500/50";
    case "ASK_ONE":
      return "bg-yellow-500/15 text-yellow-300 border-yellow-500/50";
    case "UNCERTAIN":
      return "bg-red-500/15 text-red-300 border-red-500/50";
    default:
      return "bg-gray-500/15 text-gray-300 border-gray-500/40";
  }
}

export function LiveInfoCard({ info, riskLevel, sensors }: LiveInfoCardProps) {
  const {
    emergencyType,
    confidence,
    band,
    followUpQuestion,
    followUpLoop,
  } = info;

  // Prefer the explicit prop, but fall back to whatever the SSE stream stored
  // on the LiveInfo object.
  const effectiveRisk = riskLevel ?? info.riskLevel;
  const effectiveSensors = sensors ?? info.sensors ?? [];

  return (
    <Card className="rounded-xl border-white/10 bg-white/5 p-4">
      <div className="flex flex-col gap-4">
        {/* ─── NEW TOP SECTION ─────────────────────────────────────────── */}

        {/* (a) Risk level badge — colour-coded pill. */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Risk Level
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-bold tracking-wide",
              riskBadgeClasses(effectiveRisk),
              (effectiveRisk === "CRITICAL" || effectiveRisk === "HIGH") && "ov-danger-pulse"
            )}
          >
            {effectiveRisk ?? "—"}
          </span>
        </div>

        {/* (b) Sensor status row (compact) — only when sensors are present. */}
        {effectiveSensors.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Sensors
            </span>
            <SensorStatusRow readings={effectiveSensors} />
          </div>
        )}

        {/* ─── EXISTING SECTION (kept as-is below the new top section) ────── */}

        {emergencyType !== undefined && (
          <div className="text-sm text-white">
            Emergency detected:{" "}
            <span className="font-semibold capitalize">{emergencyType}</span>
          </div>
        )}

        {/* (c) Confidence bar with percentage. */}
        {confidence !== undefined && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm text-gray-300">
              <span>Confidence</span>
              <span className="font-mono text-white">
                {Math.round(confidence)}%
              </span>
            </div>

            {/* Progress bar with a threshold marker at 85%. */}
            <div className="relative">
              <Progress value={Math.max(0, Math.min(100, confidence))} />
              {/* (f) Threshold marker at 85%. */}
              <div
                className="absolute top-0 h-full border-l border-dashed border-white/60"
                style={{ left: `${PROCEED_THRESHOLD}%` }}
                aria-hidden
              >
                <span className="absolute -top-4 -translate-x-1/2 whitespace-nowrap text-[10px] text-white/60">
                  {PROCEED_THRESHOLD}%
                </span>
              </div>
            </div>
            {/* (g) AI Summary Note */}
            {info.aiSummary && (
              <div className="mt-1 border-l-2 border-gray-600 pl-3 text-sm italic text-gray-400">
                AI: {info.aiSummary}
              </div>
            )}
          </div>
        )}

        {/* (d) Band pill (PROCEED / ASK_ONE / UNCERTAIN). */}
        {band !== undefined && (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
              CVL Decision
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-bold tracking-wide",
                bandClasses(band)
              )}
            >
              {band}
            </span>
          </div>
        )}

        {/* (e) Evidence checklist (missing-evidence prompts surface as a
            follow-up question while the CVL is still gathering vitals). */}
        {followUpQuestion !== undefined && (
          <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/5 p-3 text-sm text-yellow-300">
            <div className="font-medium">
              ⚠ Gathering evidence (Loop {followUpLoop ?? 1}/2):
            </div>
            <div className="mt-1">{followUpQuestion}</div>
          </div>
        )}
      </div>
    </Card>
  );
}
