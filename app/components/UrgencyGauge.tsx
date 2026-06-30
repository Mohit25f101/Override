"use client";

import React from "react";

export function UrgencyGauge({ score, size = 120 }: { score: number; size?: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius; // ~339.29
  const strokeDashoffset = circumference * (1 - score);

  let color = "#22c55e"; // green
  let level = "LOW";
  if (score >= 0.75) {
    color = "#ef4444"; // red
    level = "CRITICAL";
  } else if (score >= 0.6) {
    color = "#f97316"; // orange
    level = "HIGH";
  } else if (score >= 0.4) {
    color = "#f59e0b"; // amber
    level = "MEDIUM";
  }

  const percentage = Math.round(score * 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="w-full h-full transform -rotate-90">
        <circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-muted/30"
        />
        <circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: strokeDashoffset,
            transition: "stroke-dashoffset 0.8s ease, stroke 0.8s ease",
          }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center text-center">
        <span className="text-xl font-bold" style={{ color }}>{percentage}%</span>
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase mt-0.5">
          {level}
        </span>
      </div>
    </div>
  );
}
