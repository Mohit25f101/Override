import { cn } from "@/lib/utils";
import type { EmergencyState } from "./types";

const LIFECYCLE_STAGES: EmergencyState[] = [
  "Monitoring",
  "Suspicious Activity",
  "Possible Emergency",
  "Emergency Confirmed",
  "Response Active",
];

export function EmergencyLifecycle({
  currentState,
}: {
  currentState: EmergencyState;
}) {
  const currentIndex = LIFECYCLE_STAGES.indexOf(currentState);

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative flex w-full justify-between">
        {/* Background line */}
        <div className="absolute left-[10%] right-[10%] top-1 h-0.5 -translate-y-1/2 bg-white/10" />
        
        {/* Active progress line */}
        <div 
          className="absolute left-[10%] top-1 h-0.5 -translate-y-1/2 bg-orange-500 transition-all duration-700 ease-in-out" 
          style={{ width: `${Math.max(0, (currentIndex / (LIFECYCLE_STAGES.length - 1)) * 80)}%` }}
        />

        {LIFECYCLE_STAGES.map((stage, i) => {
          const isActive = i === currentIndex;
          const isPast = i < currentIndex;
          
          return (
            <div key={stage} className="z-10 flex flex-col items-center gap-2" style={{ width: "20%" }}>
              {/* Dot */}
              <div
                className={cn(
                  "h-3 w-3 rounded-full transition-all duration-500",
                  isActive
                    ? "scale-125 bg-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.8)]"
                    : isPast
                    ? "bg-orange-500"
                    : "bg-gray-700"
                )}
              />
              {/* Label */}
              <span 
                className={cn(
                  "text-center text-[10px] sm:text-xs font-semibold uppercase tracking-wider transition-colors duration-500",
                  isActive ? "text-orange-400" : isPast ? "text-white/80" : "text-white/30"
                )}
              >
                {stage}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
