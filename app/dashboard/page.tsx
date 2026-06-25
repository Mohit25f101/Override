"use client";

import { useEffect, useState } from "react";

// Minimal placeholder so router.push("/dashboard") resolves.
// The full dashboard is out of scope for the home-page build.
export default function DashboardPage() {
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("emergencyResult");
      if (raw) setResult(JSON.parse(raw));
    } catch {
      setResult(null);
    }
  }, []);

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[#0a0a0a] px-4 py-10">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <h1 className="text-2xl font-bold tracking-wide text-white">
          Decision Dashboard
        </h1>
        <pre className="overflow-auto rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-gray-300">
          {result ? JSON.stringify(result, null, 2) : "No result found."}
        </pre>
      </div>
    </main>
  );
}
