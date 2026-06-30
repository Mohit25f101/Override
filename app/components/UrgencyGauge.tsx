"use client";

import { urgencyColor } from "./taskTypes";

// ─────────────────────────────────────────────────────────────────────────────
// UrgencyGauge — a circular SVG confidence meter, built from scratch (no libs).
//   viewBox 0 0 120 120, circle cx=60 cy=60 r=54
//   circumference = 2 * PI * 54 ≈ 339.3
//   dashoffset    = circumference * (1 - score)
//   Smooth CSS transition on stroke-dashoffset (0.8s ease).
// ─────────────────────────────────────────────────────────────────────────────

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈ 339.3

interface UrgencyGaugeProps {
  score: number; // 0..1
  level?: string; // LOW | MEDIUM | HIGH | CRITICAL
  size?: number; // rendered px (square). Default 120.
}

export function UrgencyGauge({ score, level, size = 120 }: UrgencyGaugeProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0));
  const color = urgencyColor(clamped);
  const dashoffset = CIRCUMFERENCE * (1 - clamped);
  const pct = Math.round(clamped * 100);
  const small = size <= 90;

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={`Urgency ${pct} percent${level ? `, ${level}` : ""}`}
      style={{ display: "block" }}
    >
      {/* Outer track */}
      <circle
        cx={60}
        cy={60}
        r={RADIUS}
        fill="none"
        stroke="rgba(255,255,255,0.10)"
        strokeWidth={10}
      />
      {/* Progress arc — rotated so it starts at 12 o'clock. */}
      <circle
        cx={60}
        cy={60}
        r={RADIUS}
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={dashoffset}
        transform="rotate(-90 60 60)"
        style={{
          transition:
            "stroke-dashoffset 0.8s ease, stroke 0.8s ease",
          filter: `drop-shadow(0 0 6px ${color}66)`,
        }}
      />
      {/* Center percentage */}
      <text
        x={60}
        y={level ? 56 : 64}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#ffffff"
        style={{
          fontSize: small ? 22 : 28,
          fontWeight: 800,
          fontFamily: "inherit",
        }}
      >
        {pct}%
      </text>
      {/* Level text */}
      {level && (
        <text
          x={60}
          y={78}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={color}
          style={{
            fontSize: small ? 9 : 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            fontFamily: "inherit",
          }}
        >
          {level}
        </text>
      )}
    </svg>
  );
}
