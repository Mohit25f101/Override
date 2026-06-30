"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";

export interface MicroStep {
  order: number;
  title: string;
  duration_minutes: number;
  action: string;
}

export function MicroStepList({ steps }: { steps: MicroStep[] }) {
  const [completed, setCompleted] = useState<Set<number>>(new Set());

  const toggleStep = (order: number) => {
    const next = new Set(completed);
    if (next.has(order)) {
      next.delete(order);
    } else {
      next.add(order);
    }
    setCompleted(next);
  };

  const allDone = steps.length > 0 && completed.size === steps.length;

  return (
    <div className="space-y-4 w-full">
      <div className="space-y-2">
        {steps.map((step) => {
          const isDone = completed.has(step.order);
          return (
            <div 
              key={step.order}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer hover:bg-muted/50",
                isDone ? "bg-muted/30 border-muted opacity-60" : "bg-card border-border/50"
              )}
              onClick={() => toggleStep(step.order)}
            >
              <div className="mt-0.5 shrink-0 flex items-center justify-center w-5 h-5 rounded border border-input overflow-hidden">
                {isDone && (
                  <div className="w-full h-full bg-green-500 flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-black"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className={cn(
                  "font-medium text-base md:text-lg flex flex-wrap items-center gap-2",
                  isDone && "line-through decoration-2"
                )}>
                  <span>Step {step.order}: {step.title}</span>
                  <span className={cn(
                    "text-xs md:text-sm font-normal bg-muted px-2 py-0.5 rounded-full no-underline",
                    isDone ? "text-muted-foreground/70" : "text-muted-foreground"
                  )}>
                    {step.duration_minutes} min
                  </span>
                </div>
                <div className={cn("text-sm mt-1", isDone ? "text-muted-foreground/70" : "text-muted-foreground")}>
                  {step.action}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {allDone && (
        <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-center text-green-400 font-bold text-xl ov-animate-rise">
          DEADLINE BEATEN 🎯
        </div>
      )}
    </div>
  );
}
