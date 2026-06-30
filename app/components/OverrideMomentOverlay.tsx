"use client";

import React, { useEffect, useState } from "react";
import { CountdownTimer } from "./CountdownTimer";
import { RescuePlanPanel, RescuePlanResponse } from "./RescuePlanPanel";
import { TaskData } from "./TaskCard";

export function OverrideMomentOverlay({
  task,
  onDismiss,
}: {
  task: TaskData;
  onDismiss: () => void;
}) {
  const [plan, setPlan] = useState<RescuePlanResponse | null>(null);

  useEffect(() => {
    // Block scrolling behind the overlay
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  useEffect(() => {
    async function fetchPlan() {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/rescue-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: task.title,
            deadline_iso: task.deadline_iso,
            minutes_remaining: task.analysis?.minutes_remaining || 0,
            estimated_minutes: task.estimated_minutes,
            context: task.context,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setPlan(data);
        }
      } catch (e) {
        console.error("Failed to fetch rescue plan", e);
      }
    }
    fetchPlan();
  }, [task]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col override-overlay-enter overflow-y-auto">
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          background: "linear-gradient(135deg, #1a0000, #3d0000, #1a0000)",
          backgroundSize: "400% 400%",
          animation: "gradient-shift 4s ease infinite",
        }}
      />
      
      <div className="relative z-10 flex-1 flex flex-col p-6 md:p-12 w-full max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8 md:mb-16">
          <div className="text-red-500 font-bold tracking-[0.2em] text-sm uppercase flex items-center gap-2">
            <span className="text-xl">⚡</span>
            OVERRIDE ACTIVATED
          </div>
          <button 
            onClick={onDismiss}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        
        <div className="flex flex-col items-center text-center mb-8 md:mb-12">
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-8 tracking-tight max-w-4xl leading-tight">
            {task.title}
          </h1>
          
          <div className="text-3xl md:text-4xl mb-4">
            <CountdownTimer deadline_iso={task.deadline_iso} />
          </div>
          
          <div className="text-red-200/80 text-lg md:text-xl font-medium max-w-2xl">
            {task.analysis?.key_risk}
          </div>
        </div>
        
        <div className="w-full h-px bg-gradient-to-r from-transparent via-red-500/50 to-transparent my-4 md:my-8" />
        
        <RescuePlanPanel plan={plan} />
      </div>
    </div>
  );
}
