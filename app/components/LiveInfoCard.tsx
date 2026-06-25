"use client";

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { LiveInfo } from "./types";

interface LiveInfoCardProps {
  info: LiveInfo;
}

export function LiveInfoCard({ info }: LiveInfoCardProps) {
  const { emergencyType, confidence, followUpQuestion, followUpLoop } = info;

  const hasContent =
    emergencyType !== undefined ||
    confidence !== undefined ||
    followUpQuestion !== undefined;

  if (!hasContent) return null;

  return (
    <Card className="border-white/10 bg-white/5 rounded-xl p-4">
      <div className="flex flex-col gap-4">
        {emergencyType !== undefined && (
          <div className="text-sm text-white">
            Emergency detected:{" "}
            <span className="font-semibold capitalize">{emergencyType}</span>
          </div>
        )}

        {confidence !== undefined && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm text-gray-300">
              <span>Confidence</span>
              <span className="font-mono text-white">
                {Math.round(confidence)}%
              </span>
            </div>
            <Progress value={Math.max(0, Math.min(100, confidence))} />
          </div>
        )}

        {followUpQuestion !== undefined && (
          <div className="text-sm text-yellow-400">
            <div className="font-medium">
              ⚠ Asking follow-up (Loop {followUpLoop ?? 1}/2):
            </div>
            <div className="mt-1">{followUpQuestion}</div>
          </div>
        )}
      </div>
    </Card>
  );
}
