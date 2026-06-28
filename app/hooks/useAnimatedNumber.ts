"use client";

import { useEffect, useState, useRef } from "react";

export function useAnimatedNumber(value: number, durationMs = 500) {
  const [displayValue, setDisplayValue] = useState(value);
  const displayValueRef = useRef(value);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const startValue = displayValueRef.current;
    const endValue = value;

    if (startValue === endValue) return;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / durationMs, 1);
      
      // easeOutQuad
      const easeProgress = progress * (2 - progress);
      const current = startValue + (endValue - startValue) * easeProgress;
      
      setDisplayValue(current);
      displayValueRef.current = current;

      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        setDisplayValue(endValue);
        displayValueRef.current = endValue;
      }
    };

    const animId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(animId);
  }, [value, durationMs]);

  return displayValue;
}
