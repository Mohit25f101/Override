"use client";

import React from "react";
import { MicroStep, MicroStepList } from "./MicroStepList";
import { EmailDraftSection } from "./EmailDraftSection";

export interface RescuePlanResponse {
  micro_steps: MicroStep[];
  total_minutes: number;
  gemini_insight: string;
  email_subject?: string;
  email_body?: string;
  grounded_tip?: string;
}

export function RescuePlanPanel({ 
  plan 
}: { 
  plan: RescuePlanResponse | null;
}) {
  if (!plan) {
    return (
      <div className="w-full max-w-3xl mx-auto space-y-6 mt-8">
        <div className="h-16 w-full rounded-xl ov-shimmer" />
        <div className="h-40 w-full rounded-xl ov-shimmer" />
        <div className="h-32 w-full rounded-xl ov-shimmer" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-8 mt-8 pb-12 animate-in fade-in duration-700">
      <div className="text-xl md:text-2xl font-serif italic text-amber-400 text-center px-4 leading-relaxed">
        "{plan.gemini_insight}"
      </div>
      
      <div className="bg-background/40 backdrop-blur-md rounded-2xl p-6 border border-white/10 shadow-xl">
        <h3 className="text-xl font-bold mb-4 flex items-center justify-between">
          <span>Rescue Plan</span>
          <span className="text-sm font-normal text-muted-foreground bg-black/40 px-3 py-1 rounded-full border border-white/5">
            {plan.total_minutes} mins total
          </span>
        </h3>
        <MicroStepList steps={plan.micro_steps} />
      </div>
      
      {plan.grounded_tip && (
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-200 p-4 rounded-xl flex gap-3">
          <span className="text-xl shrink-0">💡</span>
          <div>
            <span className="font-bold block mb-1">Pro tip</span>
            <span className="text-sm leading-relaxed">{plan.grounded_tip}</span>
          </div>
        </div>
      )}
      
      {plan.email_subject && plan.email_body && (
        <div className="bg-background/80 backdrop-blur-md rounded-2xl overflow-hidden shadow-xl border border-white/10">
          <EmailDraftSection subject={plan.email_subject} body={plan.email_body} />
        </div>
      )}
    </div>
  );
}
