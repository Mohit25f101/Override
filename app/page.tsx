"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { VoiceInput } from "./components/VoiceInput";
import { TextInput } from "./components/TextInput";
import { Pipeline } from "./components/Pipeline";
import { LiveInfoCard } from "./components/LiveInfoCard";
import {
  type LiveInfo,
  type ResumeState,
  type StageId,
  PIPELINE_STAGES,
} from "./components/types";

// Backend endpoint. In production this is the deployed Cloud Run URL, injected
// at build time via NEXT_PUBLIC_BACKEND_URL. Falls back to localhost for local
// development. NOTE: the deployed value must be the REAL Cloud Run URL returned
// by `gcloud run deploy` — set NEXT_PUBLIC_BACKEND_URL before `npm run build`.
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000/analyze";

type InputMode = "idle" | "type";
type View = "input" | "processing";

// The request body sent to /analyze. The resume fields are only populated when
// the user is answering a follow-up question from a previously paused stream.
interface AnalyzeBody {
  text: string;
  follow_up_responses: string[];
  resume_transcript?: string;
  pending_question?: string;
  loops_used?: number;
}

// Map a backend SSE "stage" to the index of the pipeline stage it activates.
function stageIndexForEvent(stage: string): number | null {
  switch (stage) {
    case "received":
      return indexOf("receiving");
    case "extracting":
    case "extracted":
    case "reextracting":
      return indexOf("extraction");
    case "validating":
    case "follow_up":
    case "awaiting_follow_up":
    case "revalidating":
      return indexOf("validation");
    case "decision":
      return indexOf("confidence");
    case "complete":
      return indexOf("ready");
    default:
      return null;
  }
}

function indexOf(id: StageId): number {
  return PIPELINE_STAGES.findIndex((s) => s.id === id);
}

export default function HomePage() {
  const router = useRouter();

  const [view, setView] = useState<View>("input");
  const [inputMode, setInputMode] = useState<InputMode>("idle");

  const [activeIndex, setActiveIndex] = useState(0);
  const [allComplete, setAllComplete] = useState(false);
  const [liveInfo, setLiveInfo] = useState<LiveInfo>({});
  const [error, setError] = useState<string | null>(null);

  // When the backend pauses on a follow-up question, we capture the state
  // needed to resume and surface an answer box to the user.
  const [resumeState, setResumeState] = useState<ResumeState | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [submittingAnswer, setSubmittingAnswer] = useState(false);

  const startedRef = useRef(false);
  // The original emergency text, preserved across follow-up round-trips.
  const originalTextRef = useRef("");

  // Apply a single parsed SSE payload to UI state.
  const applyEvent = useCallback(
    (payload: Record<string, unknown>) => {
      const stage = String(payload.stage ?? "");

      const idx = stageIndexForEvent(stage);
      if (idx !== null) {
        setActiveIndex(idx);
      }

      if (stage === "extracted" && typeof payload.emergency_type === "string") {
        setLiveInfo((prev) => ({
          ...prev,
          emergencyType: payload.emergency_type as string,
        }));
      }

      if (
        (stage === "validating" || stage === "revalidating") &&
        typeof payload.confidence === "number"
      ) {
        setLiveInfo((prev) => ({
          ...prev,
          confidence: (payload.confidence as number) * 100,
        }));
      }

      if (stage === "follow_up") {
        setLiveInfo((prev) => ({
          ...prev,
          followUpQuestion:
            typeof payload.question === "string"
              ? (payload.question as string)
              : prev.followUpQuestion,
          followUpLoop:
            typeof payload.loop === "number"
              ? (payload.loop as number)
              : prev.followUpLoop,
        }));
      }

      // The stream has paused waiting for the user to answer a clarification
      // question. Capture the resume state and prompt for an answer; the stream
      // itself ends after this event.
      if (stage === "awaiting_follow_up") {
        const question =
          typeof payload.question === "string" ? payload.question : "";
        const transcript =
          typeof payload.resume_transcript === "string"
            ? payload.resume_transcript
            : "";
        const loopsUsed =
          typeof payload.loops_used === "number" ? payload.loops_used : 0;

        setLiveInfo((prev) => ({
          ...prev,
          followUpQuestion: question || prev.followUpQuestion,
          followUpLoop:
            typeof payload.loop === "number"
              ? (payload.loop as number)
              : prev.followUpLoop,
          confidence:
            typeof payload.confidence === "number"
              ? (payload.confidence as number) * 100
              : prev.confidence,
        }));

        setResumeState({
          resumeTranscript: transcript,
          pendingQuestion: question,
          loopsUsed,
        });
        setAnswerText("");
      }

      if (stage === "decision" && typeof payload.confidence === "number") {
        setLiveInfo((prev) => ({
          ...prev,
          confidence: (payload.confidence as number) * 100,
        }));
      }

      if (stage === "error") {
        setError(
          typeof payload.message === "string"
            ? `Error: ${payload.message}`
            : "An unknown error occurred."
        );
      }

      if (stage === "complete") {
        setAllComplete(true);
        const result = payload.result ?? {};
        try {
          sessionStorage.setItem("emergencyResult", JSON.stringify(result));
        } catch {
          // ignore storage failures
        }
        // Give the UI a beat to render "Decision Ready" before navigating.
        setTimeout(() => {
          router.push("/dashboard");
        }, 600);
      }
    },
    [router]
  );

  // Open an /analyze stream with the given body and pump every SSE event into
  // applyEvent(). Shared by the initial run and every follow-up resume so the
  // streaming/parsing logic lives in exactly one place.
  const consumeStream = useCallback(
    async (body: AnalyzeBody) => {
      const response = await fetch(BACKEND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Bad response: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Read the SSE stream, splitting on newlines and parsing "data: " lines.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const rawLine = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;

          const jsonStr = line.slice(line.indexOf(":") + 1).trim();
          if (!jsonStr) continue;

          try {
            const payload = JSON.parse(jsonStr) as Record<string, unknown>;
            applyEvent(payload);
          } catch {
            // Ignore malformed lines.
          }
        }
      }
    },
    [applyEvent]
  );

  const runAnalysis = useCallback(
    async (userInput: string) => {
      if (startedRef.current) return;
      startedRef.current = true;

      originalTextRef.current = userInput;

      setView("processing");
      setError(null);
      setActiveIndex(0);
      setAllComplete(false);
      setLiveInfo({});
      setResumeState(null);
      setAnswerText("");

      try {
        await consumeStream({ text: userInput, follow_up_responses: [] });
      } catch {
        setError("Connection error. Is the backend running on port 8000?");
      }
    },
    [consumeStream]
  );

  // Submit the user's answer to a paused follow-up question and resume the
  // pipeline with a fresh stream that carries the accumulated transcript.
  const submitFollowUpAnswer = useCallback(async () => {
    if (!resumeState) return;
    const answer = answerText.trim();
    if (!answer || submittingAnswer) return;

    setSubmittingAnswer(true);
    setError(null);

    // Clear the resume prompt: a new awaiting_follow_up may arrive next round.
    const pending = resumeState;
    setResumeState(null);

    try {
      await consumeStream({
        text: originalTextRef.current,
        resume_transcript: pending.resumeTranscript,
        pending_question: pending.pendingQuestion,
        follow_up_responses: [answer],
        loops_used: pending.loopsUsed,
      });
    } catch {
      setError("Connection error. Is the backend running on port 8000?");
      // Restore the prompt so the user can retry their answer.
      setResumeState(pending);
    } finally {
      setSubmittingAnswer(false);
      setAnswerText("");
    }
  }, [answerText, consumeStream, resumeState, submittingAnswer]);

  const handleRetry = () => {
    startedRef.current = false;
    setResumeState(null);
    setAnswerText("");
    setSubmittingAnswer(false);
    setView("input");
    setInputMode("idle");
    setActiveIndex(0);
    setAllComplete(false);
    setLiveInfo({});
    setError(null);
  };

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[#0a0a0a] px-4 py-10">
      <div className="flex w-full max-w-xl flex-col gap-10">
        {/* Header */}
        <header className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-5xl font-bold tracking-widest text-white">
            OVERRIDE
          </h1>
          <p className="text-sm text-gray-400">
            AI Decision Engine for Emergencies
          </p>
        </header>

        {/* Input view */}
        {view === "input" && (
          <section className="flex flex-col gap-4">
            <VoiceInput onSubmit={runAnalysis} />

            <button
              type="button"
              onClick={() =>
                setInputMode((m) => (m === "type" ? "idle" : "type"))
              }
              className="flex h-16 w-full items-center justify-center gap-3 rounded-xl border border-white/20 bg-white/5 text-lg font-medium tracking-wide transition-colors hover:bg-white/10"
              aria-pressed={inputMode === "type"}
            >
              <span className="text-2xl" aria-hidden>
                ⌨
              </span>
              <span>TYPE</span>
            </button>

            {inputMode === "type" && <TextInput onSubmit={runAnalysis} />}

            {error && (
              <p className="text-center text-sm text-red-400">{error}</p>
            )}
          </section>
        )}

        {/* Processing view */}
        {view === "processing" && (
          <section className="flex flex-col gap-8">
            <Pipeline activeIndex={activeIndex} allComplete={allComplete} />

            <LiveInfoCard info={liveInfo} />

            {/* Follow-up answer prompt: shown when the stream paused to collect
                a clarification answer from the user. */}
            {resumeState && !allComplete && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitFollowUpAnswer();
                }}
                className="flex flex-col gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4"
              >
                <label
                  htmlFor="follow-up-answer"
                  className="text-sm font-medium text-amber-200"
                >
                  {resumeState.pendingQuestion ||
                    "Please provide more information."}
                </label>
                <input
                  id="follow-up-answer"
                  type="text"
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  autoFocus
                  disabled={submittingAnswer}
                  placeholder="Type your answer…"
                  className="h-12 w-full rounded-lg border border-white/20 bg-black/40 px-4 text-white placeholder:text-gray-500 focus:border-amber-400/60 focus:outline-none"
                />
                <Button
                  type="submit"
                  disabled={submittingAnswer || !answerText.trim()}
                  className="h-12 rounded-lg bg-amber-400/90 font-medium text-black hover:bg-amber-300 disabled:opacity-50"
                >
                  {submittingAnswer ? "Sending…" : "Send answer"}
                </Button>
              </form>
            )}

            {error && (
              <div className="flex flex-col items-center gap-4">
                <p className="text-center text-sm text-red-400">{error}</p>
                <Button
                  type="button"
                  onClick={handleRetry}
                  variant="outline"
                  className="rounded-xl border-white/20 bg-white/5 text-white hover:bg-white/10"
                >
                  Try again
                </Button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
