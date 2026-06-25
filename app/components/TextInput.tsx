"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface TextInputProps {
  onSubmit: (text: string) => void;
}

export function TextInput({ onSubmit }: TextInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
  };

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Describe the emergency..."
        rows={4}
        className="w-full resize-none rounded-xl border border-white/20 bg-white/5 p-4 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-white/30"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />
      <Button
        type="button"
        onClick={handleSubmit}
        disabled={value.trim().length === 0}
        className="h-12 w-full rounded-xl bg-white font-bold text-black hover:bg-white/90 disabled:opacity-50"
      >
        ANALYZE
      </Button>
    </div>
  );
}
