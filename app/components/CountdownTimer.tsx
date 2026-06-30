"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function CountdownTimer({ deadline_iso }: { deadline_iso: string }) {
  const [timeLeft, setTimeLeft] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);

  useEffect(() => {
    const calc = () => {
      const now = new Date();
      const deadline = new Date(deadline_iso);
      const diff = deadline.getTime() - now.getTime();
      
      if (diff <= 0) {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      setTimeLeft({
        hours: Math.floor(diff / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      });
    };

    calc();
    const interval = setInterval(calc, 1000);
    return () => clearInterval(interval);
  }, [deadline_iso]);

  if (!timeLeft) return null;

  const totalMinutes = timeLeft.hours * 60 + timeLeft.minutes;
  const isDanger = totalMinutes < 10 && totalMinutes >= 0;
  const isFlash = totalMinutes < 2 && totalMinutes >= 0;
  
  return (
    <div className={cn(
      "font-mono transition-colors duration-300",
      isDanger ? "text-red-500 font-bold" : "text-muted-foreground",
      isFlash ? "countdown-danger text-red-500 scale-105" : ""
    )}>
      {timeLeft.hours}h {timeLeft.minutes}m {timeLeft.seconds}s remaining
    </div>
  );
}
