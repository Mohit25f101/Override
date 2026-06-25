"""
main.py — Override AI emergency decision engine backend.

A single FastAPI application exposing one endpoint, POST /analyze, which runs
the full pipeline:

    extract_emergency  →  validate  →  (optional follow-up loop)  →  decision

Progress is streamed back to the frontend in real time via Server-Sent Events
(SSE) so the UI can render each stage as it happens.

Run with:

    uvicorn main:app --reload --port 8000

Demo-mode curl test:

    curl -X POST http://localhost:8000/analyze \
      -H "Content-Type: application/json" \
      -d '{"text": "My dad collapsed", "follow_up_responses": ["No he is not breathing at all", "I cannot feel any pulse"]}'
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
    text: str                                    # the emergency input
    follow_up_responses: list[str] = []          # pre-provided answers for demo mode


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
        accumulated_text = request.text
        follow_up_responses = list(request.follow_up_responses)
        response_index = 0

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

        # 2. validate(extraction, loops_used=0) → result
        yield _event({"stage": "validating"})
        result = await _run_validate(extraction, 0)

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

            # a. Stream the follow-up event with the question.
            yield _event({
                "stage": "follow_up",
                "question": result.follow_up_question,
                "loop": next_loop,
            })

            # b. If a pre-provided answer is available, append it to the text.
            if response_index < len(follow_up_responses):
                answer = follow_up_responses[response_index]
                response_index += 1
                accumulated_text = f"{accumulated_text}\n{answer}"

            # c. Re-extract from the accumulated text.
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
