"use client";

import { useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CountdownTimer — live "2h 47m 13s remaining" in monospace.
//   < 10 min  → red + larger
//   < 2 min   → flashing (countdown-danger)
//   <= 0      → "DEADLINE PASSED"
// ─────────────────────────────────────────────────────────────────────────────

interface CountdownTimerProps {
  deadline_iso: string;
  className?: string;
}

interface Parts {
  diff: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function compute(deadline_iso: string): Parts {
  const now = new Date();
  const deadline = new Date(deadline_iso);
  const diff = deadline.getTime() - now.getTime();
  const safe = Math.max(0, diff);
  const hours = Math.floor(safe / 3600000);
  const minutes = Math.floor((safe % 3600000) / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  return { diff, hours, minutes, seconds };
}

export function CountdownTimer({ deadline_iso, className }: CountdownTimerProps) {
  const [parts, setParts] = useState<Parts>(() => compute(deadline_iso));

  useEffect(() => {
    setParts(compute(deadline_iso));
    const id = setInterval(() => setParts(compute(deadline_iso)), 1000);
    return () => clearInterval(id);
  }, [deadline_iso]);

  const totalMinutesLeft = parts.diff / 60000;
  const passed = parts.diff <= 0;
  const under10 = !passed && totalMinutesLeft < 10;
  const under2 = !passed && totalMinutesLeft < 2;

  const color = passed || under10 ? "#ef4444" : undefined;

  if (passed) {
    return (
      <span
        className={`font-mono font-bold ${className ?? ""}`}
        style={{ color: "#ef4444" }}
      >
        DEADLINE PASSED
      </span>
    );
  }

  return (
    <span
      className={`font-mono tabular-nums ${under2 ? "countdown-danger" : ""} ${
        className ?? ""
      }`}
      style={{
        color,
        fontWeight: under10 ? 800 : 600,
        fontSize: under10 ? "1.25em" : undefined,
        transition: "font-size 0.3s ease, color 0.3s ease",
      }}
    >
      {parts.hours > 0 ? `${parts.hours}h ` : ""}
      {parts.minutes}m {String(parts.seconds).padStart(2, "0")}s remaining
    </span>
  );
}
