"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";

export function TaskInputForm({ onTaskAdded }: { onTaskAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("30");
  const [context, setContext] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !deadline) return;

    setIsSubmitting(true);
    try {
      const tasks = JSON.parse(localStorage.getItem("override_tasks") || "[]");
      
      const newTask = {
        id: crypto.randomUUID(),
        title,
        description: "",
        deadline_iso: new Date(deadline).toISOString(),
        estimated_minutes: parseInt(estimatedMinutes, 10),
        context,
        created_at: new Date().toISOString()
      };

      tasks.push(newTask);
      localStorage.setItem("override_tasks", JSON.stringify(tasks));

      // Reset form
      setTitle("");
      setDeadline("");
      setEstimatedMinutes("30");
      setContext("");
      
      onTaskAdded();
      
      // We could add a toast here, but for now we'll just let the parent refresh
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-card border p-6 rounded-xl space-y-4 max-w-2xl mx-auto w-full">
      <div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What must get done?"
          required
          className="w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/50 border-b border-border/50 pb-2 focus:border-primary transition-colors"
        />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-muted-foreground">Deadline</label>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            required
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-muted-foreground">Estimated Time</label>
          <select
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="120">2 hours</option>
            <option value="180">3+ hours</option>
          </select>
        </div>
      </div>
      
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-muted-foreground">Context (Optional)</label>
        <input
          type="text"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Add context: professor name, client, etc."
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Adding..." : "Add Task"}
        </Button>
      </div>
    </form>
  );
}
