"use client";

import React from "react";
import { UrgencyGauge } from "./UrgencyGauge";
import { cn } from "@/lib/utils";

export interface TaskData {
  id: string;
  title: string;
  description: string;
  deadline_iso: string;
  estimated_minutes: number;
  context: string;
  created_at: string;
  analysis?: {
    urgency_score: number;
    urgency_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    key_risk: string;
    minutes_remaining: number;
    will_miss_deadline: boolean;
  };
}

export function TaskCard({ task }: { task: TaskData }) {
  const isCritical = task.analysis?.urgency_score !== undefined && task.analysis.urgency_score >= 0.75;
  const isHighOrCritical = task.analysis?.urgency_score !== undefined && task.analysis.urgency_score >= 0.6;
  
  const deadlineDate = new Date(task.deadline_iso);
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className={cn(
      "bg-card border p-5 rounded-xl transition-all duration-300 w-full max-w-2xl mx-auto flex flex-col gap-4",
      isCritical ? "task-card-critical border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]" : ""
    )}>
      <div className="flex justify-between items-start gap-4">
        <div className="flex flex-col gap-2">
          <h3 className="text-xl font-semibold tracking-tight">{task.title}</h3>
          
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {formatter.format(deadlineDate)}
            </span>
            
            {task.context && (
              <>
                <span>•</span>
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">
                  {task.context}
                </span>
              </>
            )}
          </div>
        </div>
        
        <div className="shrink-0 flex items-center justify-center">
          {task.analysis ? (
            <UrgencyGauge score={task.analysis.urgency_score} size={80} />
          ) : (
            <div className="w-[80px] h-[80px] rounded-full border-2 border-dashed border-muted flex items-center justify-center">
              <span className="text-[10px] text-muted-foreground uppercase">Scanning</span>
            </div>
          )}
        </div>
      </div>
      
      {isHighOrCritical && task.analysis?.key_risk && (
        <div className="pt-3 border-t border-border/50 text-sm italic text-muted-foreground flex items-start gap-2">
          <span className="text-orange-500 mt-0.5">⚠️</span>
          <span>{task.analysis.key_risk}</span>
        </div>
      )}
    </div>
  );
}
