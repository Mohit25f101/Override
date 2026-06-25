"""
main.py — Override AI emergency decision engine backend.

A single FastAPI application exposing one endpoint, POST /analyze, which runs
the full pipeline:

    extract_emergency  →  validate  →  (optional follow-up loop)  →  decision

Progress is streamed back to the frontend in real time via Server-Sent Events
(SSE) so the UI can render each stage as it happens.

Run with:

    uvicorn main:app --reload --port 8000

Demo-mode curl test (all answers supplied up front):

    curl -X POST http://localhost:8000/analyze \
      -H "Content-Type: application/json" \
      -d '{"text": "My dad collapsed", "follow_up_responses": ["No he is not breathing at all", "I cannot feel any pulse"]}'

Interactive mode
----------------
A single Server-Sent Events stream is *unidirectional*: once the server starts
streaming it cannot receive new input from the browser mid-stream. That means a
live user can be *shown* a clarification question but has no way to answer it
within the same request.

To support genuine interactive clarification the stream therefore PAUSES instead
of spinning. When the pipeline needs an answer that was not pre-supplied it
emits an ``awaiting_follow_up`` event carrying everything required to resume
(the accumulated transcript, the question, and how many loops have run) and then
ends the stream cleanly. The client collects the user's answer and re-POSTs
``/analyze`` with that resume state:

    {
      "text": "<original report>",
      "resume_transcript": "<accumulated transcript from awaiting_follow_up>",
      "pending_question": "<the question that was shown>",
      "follow_up_responses": ["<the user's answer>"],
      "loops_used": 1
    }

This is what fixes the original bug: previously the loop only ever appended
answers from a pre-supplied ``follow_up_responses`` list, so a live user (whose
list is empty) had the *same text* re-extracted every iteration, producing the
*same* missing field and the *same* question until ``MAX_VALIDATION_LOOPS``
forced a low-confidence decision. Now the loop never re-extracts identical text:
it either consumes a real answer or pauses to collect one.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from cvl import MAX_VALIDATION_LOOPS, validate
from extraction import extract_emergency


# ──────────────────────────────────────────────────────────────────────────────
# FastAPI app + CORS (wide open — this is a hackathon).
# ──────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Override — AI Emergency Decision Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────────────────────
# Request model.
# ──────────────────────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    text: str                                    # the original emergency input
    follow_up_responses: list[str] = []          # pre-provided answers (demo mode)

    # ── Interactive-resume fields ───────────────────────────────────────────
    # When the previous stream paused on an ``awaiting_follow_up`` event, the
    # client echoes these back so the server can resume exactly where it left
    # off instead of re-running the whole pipeline from scratch.
    resume_transcript: str | None = None         # accumulated transcript so far
    pending_question: str | None = None          # the question that was shown
    loops_used: int = 0                          # clarification loops already run


# ──────────────────────────────────────────────────────────────────────────────
# SSE helpers.
# ──────────────────────────────────────────────────────────────────────────────

def _event(payload: dict[str, Any]) -> dict[str, str]:
    """
    Wrap a dict as an EventSourceResponse message.

    sse-starlette expects each yielded item to be a dict with a ``data`` key
    (and optionally ``event``, ``id``, etc.). We JSON-encode the payload so the
    frontend receives a single parseable JSON object per SSE ``data:`` line.
    """
    return {"data": json.dumps(payload)}


def _run_extract(text: str):
    """Call extract_emergency in a worker thread (it does blocking network I/O)."""
    return asyncio.to_thread(extract_emergency, text)


def _run_validate(extraction, loops_used: int):
    """Call validate in a worker thread to keep the event loop responsive."""
    return asyncio.to_thread(validate, extraction, loops_used)


def _append_exchange(transcript: str, question: str | None, answer: str) -> str:
    """
    Fold a follow-up answer into the running transcript.

    Terse answers ("No", "Yes") carry no standalone meaning — an answer of "No"
    could refer to breathing, consciousness, or pulse. We therefore anchor the
    answer to the question that prompted it as a labelled "Q: … / A: …" exchange
    so ``extract_emergency()`` can map it onto the correct field. If no question
    is available we fall back to appending the bare answer.
    """
    answer = answer.strip()
    if question:
        return f"{transcript}\nQ: {question}\nA: {answer}"
    return f"{transcript}\n{answer}"


# ──────────────────────────────────────────────────────────────────────────────
# Core streaming pipeline.
# ──────────────────────────────────────────────────────────────────────────────

async def _analyze_stream(request: AnalyzeRequest) -> AsyncGenerator[dict[str, str], None]:
    """
    Drive the extraction → validation → follow-up loop, emitting one SSE event
    per stage. Every exception is caught and surfaced as an ``error`` event so a
    bad request can never crash the server.
    """
    try:
        # Resume state: if the client is answering a question from a previous
        # paused stream it sends back the accumulated transcript plus the
        # question that prompted the answer. Otherwise we start fresh from the
        # original text.
        accumulated_text = request.resume_transcript or request.text
        follow_up_responses = list(request.follow_up_responses)
        response_index = 0
        pending_question = request.pending_question
        loops_used = request.loops_used

        # If we are resuming with a pending question and the client supplied an
        # answer for it, fold that Q/A pair into the transcript *before* the
        # first extraction so the answer is actually used (root-cause fix).
        if pending_question and response_index < len(follow_up_responses):
            answer = follow_up_responses[response_index]
            response_index += 1
            accumulated_text = _append_exchange(
                accumulated_text, pending_question, answer
            )

        # 1. received ─────────────────────────────────────────────────────────
        yield _event({"stage": "received", "text": accumulated_text})

        # 2. extracting ─────────────────────────────────────────────────────────
        yield _event({"stage": "extracting"})

        # 1. extract_emergency(request.text) → extraction
        extraction = await _run_extract(accumulated_text)

        # 3. extracted ──────────────────────────────────────────────────────────
        yield _event({
            "stage": "extracted",
            "emergency_type": extraction.emergency_type,
            "raw_confidence": extraction.raw_confidence,
            "reasoning": extraction.reasoning,
        })

        # 2. validate(extraction, loops_used) → result
        #    loops_used is non-zero when resuming after a paused follow-up.
        yield _event({"stage": "validating"})
        result = await _run_validate(extraction, loops_used)

        yield _event({
            "stage": "validating",
            "confidence": result.confidence,
            "band": result.confidence_band,
            "missing": result.missing_fields,
        })

        # 3. Follow-up loop ─────────────────────────────────────────────────────
        #    while not action_ready AND loops_used < MAX_VALIDATION_LOOPS
        while not result.action_ready and result.loops_used < MAX_VALIDATION_LOOPS:
            next_loop = result.loops_used + 1
            question = result.follow_up_question

            # a. Stream the follow-up event with the question.
            yield _event({
                "stage": "follow_up",
                "question": question,
                "loop": next_loop,
            })

            # b. We need an answer to that question. There are two sources:
            #
            #    (i)  a PRE-SUPPLIED answer (demo mode) — use it immediately, or
            #    (ii) a LIVE user — who cannot reply within this one-way stream.
            #
            #    Terse answers ("No", "Yes") carry no standalone meaning, so we
            #    always anchor an answer to the question that prompted it via
            #    _append_exchange(). That lets extract_emergency() map the
            #    answer onto the correct field.
            if response_index < len(follow_up_responses):
                # (i) Demo / batch mode: consume the next pre-supplied answer.
                answer = follow_up_responses[response_index]
                response_index += 1
                accumulated_text = _append_exchange(
                    accumulated_text, question, answer
                )

                # c. Re-extract from the augmented transcript.
                yield _event({"stage": "reextracting"})
                extraction = await _run_extract(accumulated_text)

                # d. Re-validate with the incremented loop counter.
                result = await _run_validate(extraction, next_loop)

                # e. Stream the revalidating event.
                yield _event({
                    "stage": "revalidating",
                    "confidence": result.confidence,
                    "loop": next_loop,
                })
            else:
                # (ii) Live mode: we have no answer and cannot collect one over
                #      a unidirectional stream. PAUSE here instead of
                #      re-extracting the identical transcript (which would loop
                #      forever on the same question). Emit everything the client
                #      needs to resume, then end the stream cleanly.
                #
                #      This is the root-cause fix: the loop never re-processes
                #      unchanged text, so the user's answer is genuinely awaited
                #      and incorporated on the follow-up request.
                #      We persist the *incremented* loop count (next_loop), not
                #      the pre-question result.loops_used. The act of asking this
                #      question consumes a clarification round, so when the client
                #      resumes with the user's answer it must validate against the
                #      advanced count. Echoing the stale pre-question value would
                #      let a live user keep answering indefinitely without ever
                #      advancing toward MAX_VALIDATION_LOOPS (the UI would also
                #      stay stuck showing "loop 1"). Mirroring the pre-supplied
                #      path — which re-validates with next_loop — keeps live and
                #      demo modes in lockstep and forces a decision after two
                #      clarification rounds.
                yield _event({
                    "stage": "awaiting_follow_up",
                    "question": question,
                    "loop": next_loop,
                    "resume_transcript": accumulated_text,
                    "loops_used": next_loop,
                    "confidence": result.confidence,
                    "band": result.confidence_band,
                    "missing": result.missing_fields,
                })
                return

        # 4. decision ───────────────────────────────────────────────────────────
        yield _event({
            "stage": "decision",
            "confidence": result.confidence,
            "action_ready": result.action_ready,
            "forced": result.forced,
        })

        # 5. complete — full merged dict of EmergencyExtraction + ValidationResult.
        merged: dict[str, Any] = {}
        merged.update(extraction.model_dump())
        merged.update(result.model_dump())
        yield _event({"stage": "complete", "result": merged})

    except Exception as exc:  # noqa: BLE001 — never let the stream crash the server.
        yield _event({"stage": "error", "message": str(exc)})


# ──────────────────────────────────────────────────────────────────────────────
# The one endpoint.
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/analyze")
async def analyze(request: AnalyzeRequest) -> EventSourceResponse:
    """Run the full pipeline and stream progress back as Server-Sent Events."""
    return EventSourceResponse(_analyze_stream(request))


@app.get("/")
async def root() -> dict[str, str]:
    """Tiny health/info endpoint."""
    return {
        "service": "Override — AI Emergency Decision Engine",
        "endpoint": "POST /analyze (text/event-stream)",
    }
