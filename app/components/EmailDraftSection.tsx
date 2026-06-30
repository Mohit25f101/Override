"use client";

import { useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// EmailDraftSection — shows the Gemini-drafted "I'll be late" email.
//   Editable body, Copy-to-clipboard, and Open-in-email-app (mailto).
// ─────────────────────────────────────────────────────────────────────────────

interface EmailDraftSectionProps {
  subject: string;
  body: string;
}

export function EmailDraftSection({ subject, body }: EmailDraftSectionProps) {
  const [editableBody, setEditableBody] = useState(body);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEditableBody(body);
  }, [body]);

  async function copyToClipboard() {
    const text = `${subject}\n\n${editableBody}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked — silently ignore */
    }
  }

  function openInEmailApp() {
    const url =
      "mailto:?subject=" +
      encodeURIComponent(subject) +
      "&body=" +
      encodeURIComponent(editableBody);
    window.open(url);
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.04] p-5">
      <p className="text-sm font-bold uppercase tracking-wide text-amber-300">
        Override drafted this for you
      </p>

      {/* Subject */}
      <div className="rounded-lg border border-white/10 bg-black/40 px-4 py-2.5">
        <span className="text-xs uppercase tracking-wide text-gray-500">
          Subject
        </span>
        <p className="text-sm font-semibold text-white">{subject}</p>
      </div>

      {/* Body */}
      <textarea
        value={editableBody}
        onChange={(e) => setEditableBody(e.target.value)}
        rows={7}
        className="w-full resize-y rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm leading-relaxed text-gray-200 outline-none focus:border-white/30"
      />

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={copyToClipboard}
          className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-white/90"
        >
          {copied ? "✓ Copied" : "Copy to Clipboard"}
        </button>
        <button
          type="button"
          onClick={openInEmailApp}
          className="rounded-lg border border-white/20 bg-transparent px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-white/10"
        >
          Open in Email App
        </button>
      </div>
    </div>
  );
}
