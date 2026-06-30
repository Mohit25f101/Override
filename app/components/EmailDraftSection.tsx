"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";

export function EmailDraftSection({ subject, body }: { subject: string; body: string }) {
  const [editedBody, setEditedBody] = useState(body);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(`${subject}\n\n${editedBody}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenEmail = () => {
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(editedBody)}`);
  };

  return (
    <div className="space-y-4 bg-muted/20 border rounded-xl p-4 md:p-6 mt-6">
      <h4 className="font-semibold text-lg flex items-center gap-2">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Override drafted this for you
      </h4>
      
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground font-medium">Subject</div>
        <div className="bg-background border px-3 py-2 rounded-md font-medium text-sm">
          {subject}
        </div>
      </div>
      
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground font-medium">Body</div>
        <textarea
          value={editedBody}
          onChange={(e) => setEditedBody(e.target.value)}
          className="w-full min-h-[150px] bg-background border px-3 py-2 rounded-md text-sm resize-y focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      
      <div className="flex flex-wrap gap-3 pt-2">
        <Button onClick={handleCopy} variant="secondary">
          {copied ? "Copied!" : "Copy to Clipboard"}
        </Button>
        <Button onClick={handleOpenEmail} variant="default">
          Open in Email App
        </Button>
      </div>
    </div>
  );
}
