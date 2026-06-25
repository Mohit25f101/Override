"use client";

import { cn } from "@/lib/utils";
import {
  PIPELINE_STAGES,
  type StageId,
  type StageStatus,
} from "./types";

interface PipelineProps {
  // Index of the currently active stage in PIPELINE_STAGES (0-based).
  // Stages before it are "complete", stages after are "default".
  activeIndex: number;
  // When true, every stage is rendered complete (final state).
  allComplete?: boolean;
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

export function Pipeline({ activeIndex, allComplete = false }: PipelineProps) {
  return (
    <ul className="flex flex-col gap-4">
      {PIPELINE_STAGES.map((stage, index) => {
        const status = statusFor(index, activeIndex, allComplete);
        return <StageRow key={stage.id} id={stage.id} status={status} />;
      })}
    </ul>
  );
}

function StageRow({ id, status }: { id: StageId; status: StageStatus }) {
  const label = PIPELINE_STAGES.find((s) => s.id === id)?.label ?? id;

  return (
    <li className="flex items-center gap-4">
      <span
        className={cn(
          "h-4 w-4 shrink-0 rounded-full",
          status === "default" && "bg-gray-600",
          status === "active" && "bg-blue-400 animate-pulse",
          status === "complete" && "bg-green-400"
        )}
        aria-hidden
      />
      <span
        className={cn(
          "text-base",
          status === "default" && "text-gray-500",
          status === "active" && "text-white font-medium",
          status === "complete" && "text-gray-300"
        )}
      >
        {label}
        {status === "complete" && (
          <span className="ml-2 text-green-400" aria-hidden>
            ✓
          </span>
        )}
      </span>
    </li>
  );
}
