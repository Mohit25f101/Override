"use client";

import { cn } from "@/lib/utils";
import type { SensorAvailability, SensorReading } from "./types";

interface SensorGridProps {
  readings: SensorReading[];
  // Optional compact mode renders a single horizontal row of small badges.
  compact?: boolean;
}

const BADGE_LABEL: Record<SensorAvailability, string> = {
  live: "LIVE",
  demo: "DEMO",
  unavailable: "N/A",
};

function badgeClasses(a: SensorAvailability): string {
  switch (a) {
    case "live":
      return "bg-green-500/15 text-green-300 border-green-500/40";
    case "demo":
      return "bg-orange-500/15 text-orange-300 border-orange-500/50";
    case "unavailable":
    default:
      return "bg-gray-500/10 text-gray-400 border-gray-500/30";
  }
}

function dotClasses(a: SensorAvailability): string {
  switch (a) {
    case "live":
      return "bg-green-400 animate-pulse";
    case "demo":
      return "bg-orange-400 animate-pulse";
    case "unavailable":
    default:
      return "bg-gray-500";
  }
}

/** A small inline sensor badge (used in headers / LiveInfoCard). */
export function SensorBadge({ reading }: { reading: SensorReading }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        badgeClasses(reading.availability)
      )}
      title={`${reading.label}: ${reading.value} (${BADGE_LABEL[reading.availability]})`}
    >
      <span aria-hidden>{reading.icon}</span>
      <span>{reading.label}</span>
      <span className="font-mono opacity-80">{BADGE_LABEL[reading.availability]}</span>
    </span>
  );
}

/** A row of compact sensor badges. */
export function SensorStatusRow({ readings }: { readings: SensorReading[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {readings.map((r) => (
        <SensorBadge key={r.key} reading={r} />
      ))}
    </div>
  );
}

/** The full sensor status grid (animated cards). */
export function SensorGrid({ readings, compact = false }: SensorGridProps) {
  if (compact) return <SensorStatusRow readings={readings} />;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {readings.map((r) => (
        <div
          key={r.key}
          className={cn(
            "flex flex-col gap-2 rounded-xl border bg-white/5 p-3 transition-all",
            r.availability === "live" && "border-green-500/30",
            r.availability === "demo" && "border-orange-500/40",
            r.availability === "unavailable" && "border-white/10"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-2xl" aria-hidden>
              {r.icon}
            </span>
            <span className={cn("h-2.5 w-2.5 rounded-full", dotClasses(r.availability))} />
          </div>
          <div className="text-sm font-medium text-white">{r.label}</div>
          <div className="font-mono text-lg text-white">{r.value}</div>
          <span
            className={cn(
              "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide",
              badgeClasses(r.availability)
            )}
          >
            {BADGE_LABEL[r.availability]}
          </span>
        </div>
      ))}
    </div>
  );
}
