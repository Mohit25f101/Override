"use client";

import React, { useEffect, useState, useMemo } from "react";
import { TaskInputForm } from "../components/TaskInputForm";
import { TaskCard, TaskData } from "../components/TaskCard";
import { OverrideMomentOverlay } from "../components/OverrideMomentOverlay";
import { cn } from "@/lib/utils";

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [overrideActive, setOverrideActive] = useState(false);
  const [overrideTask, setOverrideTask] = useState<TaskData | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Initialize from localStorage on mount (hydration safe)
  useEffect(() => {
    setIsClient(true);
    if (typeof window !== "undefined") {
      try {
        const stored = JSON.parse(localStorage.getItem("override_tasks") || "[]");
        setTasks(stored);
      } catch (e) {
        console.error("Failed to parse tasks", e);
      }
    }
  }, []);

  // Polling loop
  useEffect(() => {
    if (tasks.length === 0) return;

    const pollUrgency = async () => {
      const updated = await Promise.all(
        tasks.map(async (task) => {
          try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/task-analyze`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: task.title,
                description: task.description || "",
                deadline_iso: task.deadline_iso,
                estimated_minutes: task.estimated_minutes,
                context: task.context,
              }),
            });
            if (!res.ok) return task;
            const analysis = await res.json();
            return { ...task, analysis };
          } catch (e) {
            return task;
          }
        })
      );
      
      // Update local state and also persist analysis results to localStorage if desired,
      // but keeping them in memory is fine for the polling loop as requested.
      setTasks(updated);

      // Trigger OVERRIDE MOMENT if any task hits CRITICAL
      const critical = updated.find((t) => t.analysis && t.analysis.urgency_score >= 0.75);
      if (critical && !overrideActive) {
        setOverrideTask(critical);
        setOverrideActive(true);
      }
    };

    pollUrgency();
    const interval = setInterval(pollUrgency, 60000);
    return () => clearInterval(interval);
  }, [tasks.length, overrideActive]);

  const handleTaskAdded = () => {
    try {
      const stored = JSON.parse(localStorage.getItem("override_tasks") || "[]");
      setTasks(stored);
    } catch (e) {}
  };

  const highestUrgency = useMemo(() => {
    let max = 0;
    tasks.forEach(t => {
      if (t.analysis && t.analysis.urgency_score > max) max = t.analysis.urgency_score;
    });
    return max;
  }, [tasks]);

  const stateClass = 
    highestUrgency >= 0.75 ? "bg-black" : 
    highestUrgency >= 0.4 ? "bg-[#110a05]" : // warm amber tint
    "bg-background"; // calm

  if (!isClient) return null;

  return (
    <div className={cn("min-h-screen transition-colors duration-1000", stateClass)}>
      {overrideActive && overrideTask && (
        <OverrideMomentOverlay 
          task={overrideTask} 
          onDismiss={() => {
            setOverrideActive(false);
          }} 
        />
      )}
      
      <div className="container max-w-4xl mx-auto py-12 px-4 md:px-8">
        <h1 className="text-3xl font-bold tracking-tight mb-8">Override Your Deadlines</h1>
        
        <TaskInputForm onTaskAdded={handleTaskAdded} />
        
        <div className="mt-12 space-y-6">
          <h2 className="text-xl font-semibold tracking-tight text-muted-foreground">
            Active Tasks
          </h2>
          
          {tasks.length === 0 ? (
            <div className="text-center py-12 border border-dashed rounded-xl border-muted-foreground/30 text-muted-foreground">
              No active tasks. Take a breath.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {tasks.map(task => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
