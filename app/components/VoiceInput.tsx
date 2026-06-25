"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Minimal typings for the Web Speech API (not in TS DOM lib by default).
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const SILENCE_TIMEOUT_MS = 2500;

interface VoiceInputProps {
  // Fires once a completed transcript is ready to submit.
  onSubmit: (transcript: string) => void;
}

export function VoiceInput({ onSubmit }: VoiceInputProps) {
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef("");
  const submittedRef = useRef(false);

  // Detect support once on mount.
  useEffect(() => {
    const Ctor =
      (typeof window !== "undefined" &&
        ((window as unknown as { SpeechRecognition?: SpeechRecognitionCtor })
          .SpeechRecognition ||
          (
            window as unknown as {
              webkitSpeechRecognition?: SpeechRecognitionCtor;
            }
          ).webkitSpeechRecognition)) ||
      null;
    setSupported(!!Ctor);
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    clearSilenceTimer();
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
  }, [clearSilenceTimer]);

  // Reset the 2.5s silence countdown; firing it stops recognition,
  // which triggers onend -> auto-submit.
  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      stopRecognition();
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, stopRecognition]);

  const startRecording = useCallback(() => {
    const Ctor =
      (typeof window !== "undefined" &&
        ((window as unknown as { SpeechRecognition?: SpeechRecognitionCtor })
          .SpeechRecognition ||
          (
            window as unknown as {
              webkitSpeechRecognition?: SpeechRecognitionCtor;
            }
          ).webkitSpeechRecognition)) ||
      null;

    if (!Ctor) {
      setSupported(false);
      return;
    }

    // If already recording, stop instead (toggle behaviour).
    if (recording) {
      stopRecognition();
      return;
    }

    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    submittedRef.current = false;
    transcriptRef.current = "";
    setTranscript("");

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let full = "";
      for (let i = 0; i < event.results.length; i += 1) {
        full += event.results[i][0].transcript;
      }
      transcriptRef.current = full;
      setTranscript(full);
      // Reset silence countdown on every speech result.
      armSilenceTimer();
    };

    recognition.onerror = () => {
      // On error, just stop; onend will fire next.
      clearSilenceTimer();
    };

    recognition.onend = () => {
      clearSilenceTimer();
      setRecording(false);
      recognitionRef.current = null;
      const finalText = transcriptRef.current.trim();
      if (!submittedRef.current && finalText.length > 0) {
        submittedRef.current = true;
        onSubmit(finalText);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setRecording(true);
      // Start an initial silence timer in case the user never speaks.
      armSilenceTimer();
    } catch {
      setRecording(false);
      recognitionRef.current = null;
    }
  }, [recording, stopRecognition, armSilenceTimer, clearSilenceTimer, onSubmit]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      clearSilenceTimer();
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          // ignore
        }
      }
    };
  }, [clearSilenceTimer]);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={startRecording}
        disabled={!supported}
        className={cn(
          "flex h-16 w-full items-center justify-center gap-3 rounded-xl border bg-white/5 text-lg font-medium transition-colors",
          "hover:bg-white/10",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/5",
          recording
            ? "border-red-500 animate-pulse"
            : "border-white/20"
        )}
        aria-pressed={recording}
      >
        <span className="text-2xl" aria-hidden>
          🎤
        </span>
        <span className="tracking-wide">
          {recording ? "LISTENING…" : "SPEAK"}
        </span>
      </button>

      {!supported && (
        <p className="text-sm text-gray-400">
          Voice not supported in this browser
        </p>
      )}

      {supported && recording && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300 min-h-[3rem]">
          {transcript ? (
            transcript
          ) : (
            <span className="text-gray-500">Listening…</span>
          )}
        </div>
      )}
    </div>
  );
}
