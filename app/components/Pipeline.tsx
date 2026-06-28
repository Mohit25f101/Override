"use client";

import { cn } from "@/lib/utils";
import {
  PIPELINE_STAGES,
  type PipelineStage,
  type StageStatus,
  type SensorReading,
} from "./types";

interface PipelineProps {
  // Index of the currently active stage in PIPELINE_STAGES (0-based).
  // Stages before it are "complete", stages after are "default".
  activeIndex: number;
  // When true, every stage is rendered complete (final state).
  allComplete?: boolean;
  // Sensor readings — used to render the count badge on the Sensors stage.
  sensors?: SensorReading[];
}

function statusFor(
  index: number,
  activeIndex: number,
  allComplete: boolean
): StageStatus {
  if (allComplete) return "complete";
  if (index < activeIndex) return "complete";
  if (index === activeIndex) return "active";
  return "default";
}

function sensorCounts(sensors: SensorReading[] | undefined) {
  const live = sensors?.filter((s) => s.availability === "live").length ?? 0;
  const demo = sensors?.filter((s) => s.availability === "demo").length ?? 0;
  const unavailable =
    sensors?.filter((s) => s.availability === "unavailable").length ?? 0;
  return { live, demo, unavailable };
}

export function Pipeline({
  activeIndex,
  allComplete = false,
  sensors,
}: PipelineProps) {
  return (
    <ul className="flex flex-col gap-3">
      {PIPELINE_STAGES.map((stage, index) => {
        const status = statusFor(index, activeIndex, allComplete);
        return (
          <StageRow
            key={stage.id}
            stage={stage}
            status={status}
            sensors={stage.id === "sensors" ? sensors : undefined}
          />
        );
      })}
    </ul>
  );
}

function StageRow({
  stage,
  status,
  sensors,
}: {
  stage: PipelineStage;
  status: StageStatus;
  sensors?: SensorReading[];
}) {
  const { live, demo, unavailable } = sensorCounts(sensors);

  return (
    <li
      className={cn(
        "flex items-center gap-4 rounded-xl border px-4 py-3 transition-all",
        status === "default" && "border-white/5 bg-transparent",
        status === "active" &&
          "border-blue-400/50 bg-blue-400/5 shadow-[0_0_20px_-6px_rgba(96,165,250,0.6)]",
        status === "complete" && "border-green-400/20 bg-green-400/5"
      )}
    >
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          status === "default" && "bg-gray-700 text-gray-400",
          status === "active" && "bg-blue-400 text-black animate-pulse",
          status === "complete" && "bg-green-400 text-black"
        )}
        aria-hidden
      >
        {status === "complete" ? "✓" : PIPELINE_STAGES.indexOf(stage) + 1}
      </span>

      <div className="flex flex-1 flex-col">
        <span
          className={cn(
            "text-base",
            status === "default" && "text-gray-500",
            status === "active" && "font-semibold text-white",
            status === "complete" && "text-gray-200"
          )}
        >
          {stage.label}
        </span>
        <span className="text-xs text-gray-500">{stage.sublabel}</span>
      </div>

      {/* Sensor-count badge on the Sensors stage. */}
      {sensors && sensors.length > 0 && (
        <span className="shrink-0 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs font-medium">
          <span className="text-green-400">{live} live</span>
          <span className="text-gray-600"> / </span>
          <span className="text-orange-400">{demo} demo</span>
          <span className="text-gray-600"> / </span>
          <span className="text-gray-400">{unavailable} N/A</span>
        </span>
      )}
    </li>
  );
}

