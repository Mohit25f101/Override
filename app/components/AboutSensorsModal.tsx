"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FEATURE_STATUS_ROWS } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// "About sensors" modal — the technical-honesty panel required by the spec.
// Renders FEATURE_STATUS_ROWS verbatim so a judge can see exactly what is real
// (Implemented), partial, simulated (Demo Mode), or planned (Future Work).
//
// Self-contained: a trigger button + an accessible overlay dialog, with no extra
// UI-library dependency (the project ships only button/card/progress).
// ─────────────────────────────────────────────────────────────────────────────

// Map a status label to a colour-coded badge.
function statusBadgeClasses(status: string): string {
  switch (status) {
    case "Implemented":
      return "bg-green-500/15 text-green-300 border-green-500/40";
    case "Partially Implemented":
      return "bg-yellow-500/15 text-yellow-300 border-yellow-500/40";
    case "Demo Mode":
      return "bg-orange-500/15 text-orange-300 border-orange-500/40";
    case "Future Work":
    default:
      return "bg-gray-500/15 text-gray-400 border-gray-500/40";
  }
}

export function AboutSensorsModal({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  // Close on Escape and lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        variant="outline"
        className={cn(
          "h-9 w-fit rounded-lg border-white/15 bg-transparent text-xs text-gray-300 hover:bg-white/10",
          className
        )}
      >
        ℹ︎ About sensors
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="about-sensors-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          {/* Panel */}
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-[#121212] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="about-sensors-title"
                  className="text-lg font-bold text-white"
                >
                  About sensors
                </h2>
                <p className="mt-1 text-xs text-gray-400">
                  What is real vs. simulated vs. planned in this build.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <ul className="mt-4 flex flex-col divide-y divide-white/5">
              {FEATURE_STATUS_ROWS.map((row) => (
                <li
                  key={row.label}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <span className="text-sm text-gray-200">{row.label}</span>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                      statusBadgeClasses(row.status)
                    )}
                  >
                    {row.status}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-[11px] leading-relaxed text-gray-500">
              Anything marked “Demo Mode” is simulated and tagged with an orange
              DEMO badge in the UI. We do not claim capabilities we have not
              built.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
