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
from typing import Any, AsyncGenerator, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from cvl import MAX_VALIDATION_LOOPS, SensorPrior, run_deadline_cvl, validate
from extraction import (
    PRIMARY_MODEL,
    build_sensor_prompt,
    extract_emergency,
    make_gemini_client,
)

# ──────────────────────────────────────────────────────────────────────────────
# Non-blocking pipeline tunables.
# ──────────────────────────────────────────────────────────────────────────────

# Hard ceiling for the BACKGROUND Gemini enrichment. The deterministic alert is
# already on screen long before this; if Gemini is slower than this we simply
# stream the alert without the AI summary rather than ever blocking the user.
GEMINI_BACKGROUND_TIMEOUT_SECONDS: float = 8.0


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

    # Every question already put to the user, so the CVL never repeats one (the
    # strict no-awkward-loop guardrail). The client accumulates and echoes these.
    asked_questions: list[str] = Field(default_factory=list)
    # True when the previous question's countdown expired with no answer. The
    # pipeline then assumes the worst (silence → likely unconscious) instead of
    # waiting, and unlocks emergency actions immediately.
    timed_out: bool = False


# ──────────────────────────────────────────────────────────────────────────────
# Sensor-pipeline request models.
#
# These mirror the TypeScript EvidenceObject / RiskAssessment produced in the
# browser (app/lib/sensorFusion.ts and app/lib/riskEngine.ts). The backend never
# sees raw sensor objects — only this already-fused evidence + the transparent
# rule-based risk assessment, exactly as the frontend computes them.
# ──────────────────────────────────────────────────────────────────────────────

class EvidenceObject(BaseModel):
    motion_anomaly: bool | None = None       # acceleration spike detected
    location_available: bool = False         # live GPS fix present
    speed_kmh: float | None = None           # from GPS, null if unavailable
    audio_level: float | None = None         # 0–100 RMS, null if mic unavailable
    battery_low: bool | None = None          # true if battery < 15%
    device_stationary: bool | None = None    # true if no motion for > 30 s
    timestamp: int | None = None             # epoch ms
    sources_used: list[str] = Field(default_factory=list)   # real sensors
    demo_sources: list[str] = Field(default_factory=list)   # simulated sensors


class RiskAssessment(BaseModel):
    risk_level: str = "UNKNOWN"              # CRITICAL/HIGH/MODERATE/LOW/UNKNOWN
    emergency_type: str = "Unknown"
    confidence: float = 0.0                  # 0–1
    missing_evidence: list[str] = Field(default_factory=list)
    rules_fired: list[str] = Field(default_factory=list)
    headline: str | None = None             # action-oriented instant headline


class SensorAnalyzeRequest(BaseModel):
    """Body for POST /sensor-analyze."""

    evidence: EvidenceObject
    risk: RiskAssessment | None = None
    text: str = ""                                # optional caller free-text

    # Same interactive-resume fields as AnalyzeRequest so the follow-up loop
    # works identically for the sensor pipeline.
    follow_up_responses: list[str] = []
    resume_transcript: str | None = None
    pending_question: str | None = None
    loops_used: int = 0
    asked_questions: list[str] = Field(default_factory=list)
    timed_out: bool = False


# ──────────────────────────────────────────────────────────────────────────────
# Deadline-crisis request/response models (added for the Vibe2Ship pivot).
#
# Override now also runs its Confidence-Validated Loop over DEADLINE risk: the
# same loop, re-scored to answer "how likely is this person to miss their
# deadline?" instead of "how likely is this an emergency?". These models back
# the three new endpoints (/task-analyze, /rescue-plan, /draft-email) and live
# BELOW the existing emergency models without touching them.
# ──────────────────────────────────────────────────────────────────────────────

class TaskInput(BaseModel):
    title: str
    description: str
    deadline_iso: str                            # ISO-8601: "2024-06-30T18:00:00"
    estimated_minutes: int                       # how long the user thinks it takes
    context: Optional[str] = None                # "CS101 assignment", "proposal", …


class MicroStep(BaseModel):
    order: int
    title: str
    duration_minutes: int
    action: str                                  # specific, concrete action


class TaskAnalysisResponse(BaseModel):
    urgency_score: float                         # 0.0 to 1.0 — the CVL output
    urgency_level: str                           # LOW | MEDIUM | HIGH | CRITICAL
    minutes_remaining: int
    will_miss_deadline: bool                     # True if urgency_score >= 0.75
    key_risk: str                                # one sentence: why it is at risk
    cvl_iterations: int                          # how many CVL loops ran


class RescuePlanRequest(BaseModel):
    title: str
    deadline_iso: str
    minutes_remaining: int
    estimated_minutes: int
    context: Optional[str] = None


class RescuePlanResponse(BaseModel):
    micro_steps: List[MicroStep]
    total_minutes: int
    gemini_insight: str                          # one powerful, specific advice
    email_subject: Optional[str] = None          # pre-filled if likely late
    email_body: Optional[str] = None             # Gemini-drafted if likely late
    grounded_tip: Optional[str] = None           # from Google Search grounding


class EmailDraftRequest(BaseModel):
    task_title: str
    recipient_type: str                          # professor | manager | client | team
    original_deadline: str                       # human-readable: "today 6pm"
    new_eta: str                                 # "tomorrow morning by 10am"
    reason: Optional[str] = None


class EmailDraftResponse(BaseModel):
    subject: str
    body: str
    tone: str                                    # formal | apologetic | proactive


# ──────────────────────────────────────────────────────────────────────────────
# Sensor-pipeline prompt + prior builders.
# ──────────────────────────────────────────────────────────────────────────────

def _summarise_evidence(ev: EvidenceObject) -> str:
    """Render the fused EvidenceObject as a compact human-readable summary."""
    parts: list[str] = []

    def _label(name: str) -> str:
        if name in ev.demo_sources:
            return f"{name} (DEMO)"
        return name

    if ev.motion_anomaly is not None:
        parts.append(
            f"- Motion anomaly: {'YES — acceleration spike' if ev.motion_anomaly else 'no'} "
            f"[{_label('motion')}]"
        )
    parts.append(
        f"- GPS location available: {'yes' if ev.location_available else 'no'} "
        f"[{_label('gps')}]"
    )
    if ev.speed_kmh is not None:
        parts.append(f"- Speed: {ev.speed_kmh:.1f} km/h [{_label('gps')}]")
    if ev.audio_level is not None:
        parts.append(f"- Audio level (0–100 RMS): {ev.audio_level:.0f} [{_label('audio')}]")
    if ev.battery_low is not None:
        parts.append(f"- Battery low (<15%): {'yes' if ev.battery_low else 'no'} [{_label('battery')}]")
    if ev.device_stationary is not None:
        parts.append(
            f"- Device stationary >30s: {'yes' if ev.device_stationary else 'no'} "
            f"[{_label('motion')}]"
        )
    if ev.sources_used:
        parts.append(f"- Real sensors contributing: {', '.join(ev.sources_used)}")
    if ev.demo_sources:
        parts.append(f"- Simulated (DEMO) sensors: {', '.join(ev.demo_sources)}")
    return "\n".join(parts)


def _summarise_risk(risk: RiskAssessment | None) -> str:
    """Render the RiskAssessment as a compact human-readable summary."""
    if risk is None:
        return ""
    lines = [
        f"- Risk level: {risk.risk_level}",
        f"- Suspected emergency type: {risk.emergency_type}",
        f"- Rule-based confidence: {risk.confidence:.2f}",
    ]
    if risk.rules_fired:
        lines.append(f"- Rules fired: {'; '.join(risk.rules_fired)}")
    if risk.missing_evidence:
        lines.append(f"- Missing evidence that would raise confidence: {', '.join(risk.missing_evidence)}")
    return "\n".join(lines)


def _sensor_prior_from(req: SensorAnalyzeRequest) -> SensorPrior:
    """Map the request's risk + GPS availability onto the CVL SensorPrior."""
    return SensorPrior(
        risk_confidence=req.risk.confidence if req.risk else 0.0,
        location_available=req.evidence.location_available,
    )


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


def _run_validate(
    extraction,
    loops_used: int,
    sensor_prior: SensorPrior | None = None,
    asked_questions: list[str] | None = None,
):
    """Call validate in a worker thread to keep the event loop responsive."""
    return asyncio.to_thread(
        validate, extraction, loops_used, sensor_prior, asked_questions or []
    )


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

async def _analyze_stream(
    request: AnalyzeRequest,
    sensor_prior: SensorPrior | None = None,
    risk: RiskAssessment | None = None,
) -> AsyncGenerator[dict[str, str], None]:
    """
    Event-driven, NON-BLOCKING pipeline.

    Detect -> Show Immediately -> Think (Async) -> Improve -> Act.

    The single most important change vs. the old design: the deterministic Risk
    Assessment is yielded the INSTANT the stream opens (``risk_flagged``), so the
    UI can paint "Possible Collision" before Gemini is ever called. Gemini then
    runs as a BACKGROUND task (``asyncio.create_task``) with a hard timeout -- its
    output only ever ENRICHES the already-visible alert; it can never gate it.

    Guardrails:
      * The CVL is told every question already asked, so it never repeats one
        (strict de-duplication). When no NEW question remains, or the client
        reports a response timeout, the pipeline assumes the worst and proceeds.
      * Every exception is surfaced as an ``error`` event so the stream can never
        crash the server.
    """
    try:
        accumulated_text = request.resume_transcript or request.text
        follow_up_responses = list(request.follow_up_responses)
        response_index = 0
        pending_question = request.pending_question
        loops_used = request.loops_used
        asked_questions = list(request.asked_questions)

        # Fold a just-answered question into the transcript before extracting.
        if pending_question and response_index < len(follow_up_responses):
            answer = follow_up_responses[response_index]
            response_index += 1
            accumulated_text = _append_exchange(
                accumulated_text, pending_question, answer
            )

        # ── 0. DETECT -> SHOW IMMEDIATELY ────────────────────────────────────
        # Yield the deterministic risk assessment FIRST, before any AI call. This
        # is what unblocks the frontend in fractions of a second.
        if risk is not None:
            yield _event({
                "stage": "risk_flagged",
                "risk_level": risk.risk_level,
                "emergency_type": risk.emergency_type,
                "confidence": risk.confidence,
                "headline": risk.headline or f"{risk.emergency_type}",
                "rules_fired": risk.rules_fired,
            })

        yield _event({"stage": "received", "text": accumulated_text})

        # ── 1. THINK (ASYNC) ─────────────────────────────────────────────────
        # Kick off Gemini extraction as a BACKGROUND task. The deterministic
        # alert is already on screen; this never gates it.
        yield _event({"stage": "extracting", "background": True})
        gemini_task: asyncio.Task = asyncio.create_task(
            _run_extract(accumulated_text)
        )

        # Wait for Gemini, but only up to a hard ceiling. If it is slow we
        # proceed on sensor/risk evidence alone rather than ever blocking.
        try:
            extraction = await asyncio.wait_for(
                asyncio.shield(gemini_task),
                timeout=GEMINI_BACKGROUND_TIMEOUT_SECONDS,
            )
            ai_enriched = True
        except asyncio.TimeoutError:
            extraction = await _run_extract("")  # fast fallback extraction
            ai_enriched = False
            yield _event({
                "stage": "ai_timeout",
                "message": "AI enrichment slow — proceeding on sensor evidence.",
            })

        # ── 2. IMPROVE ───────────────────────────────────────────────────────
        yield _event({
            "stage": "extracted",
            "emergency_type": extraction.emergency_type,
            "raw_confidence": extraction.raw_confidence,
            "reasoning": extraction.reasoning,
            "ai_enriched": ai_enriched,
        })

        yield _event({"stage": "validating"})
        result = await _run_validate(
            extraction, loops_used, sensor_prior, asked_questions
        )

        yield _event({
            "stage": "validating",
            "confidence": result.confidence,
            "band": result.confidence_band,
            "missing": result.missing_fields,
        })

        # ── 3. Follow-up loop (non-repeating, auto-progressing) ──────────────
        while not result.action_ready and result.loops_used < MAX_VALIDATION_LOOPS:
            next_loop = result.loops_used + 1
            question = result.follow_up_question

            # Strict de-dup: never re-ask a question we already put to the user.
            # If the CVL has nothing new (or somehow repeats), break out and let
            # the worst-case fallback below fire instead of looping awkwardly.
            if question is None or question in asked_questions:
                break

            asked_questions = asked_questions + [question]

            yield _event({
                "stage": "follow_up",
                "question": question,
                "loop": next_loop,
            })

            if response_index < len(follow_up_responses):
                # Demo / batch mode: consume the next pre-supplied answer. Terse
                # answers are anchored to their question so extract_emergency()
                # maps them onto the correct field.
                answer = follow_up_responses[response_index]
                response_index += 1
                accumulated_text = _append_exchange(
                    accumulated_text, question, answer
                )

                yield _event({"stage": "reextracting"})
                extraction = await _run_extract(accumulated_text)
                result = await _run_validate(
                    extraction, next_loop, sensor_prior, asked_questions
                )

                yield _event({
                    "stage": "revalidating",
                    "confidence": result.confidence,
                    "loop": next_loop,
                })
            else:
                # Live mode: pause and let the client collect ONE answer. The
                # client runs a "time-to-respond" countdown; if it expires it
                # re-POSTs with timed_out=True so we assume the worst and proceed.
                # We persist the incremented loop count plus the full
                # asked_questions list so de-dup survives the round-trip.
                yield _event({
                    "stage": "awaiting_follow_up",
                    "question": question,
                    "loop": next_loop,
                    "resume_transcript": accumulated_text,
                    "loops_used": next_loop,
                    "asked_questions": asked_questions,
                    "confidence": result.confidence,
                    "band": result.confidence_band,
                    "missing": result.missing_fields,
                })
                return

        # If we broke out because no NEW question remained, force a safe,
        # worst-case-assumption decision rather than stalling.
        if not result.action_ready:
            result = result.model_copy(update={
                "action_ready": True,
                "forced": True,
                "follow_up_question": None,
                "warning": result.warning
                or "No new information available — treating as a critical "
                "emergency until confirmed.",
            })

        # ── 4. ACT — final decision ──────────────────────────────────────────
        yield _event({
            "stage": "decision",
            "confidence": result.confidence,
            "action_ready": result.action_ready,
            "forced": result.forced,
        })

        merged: dict[str, Any] = {}
        merged.update(extraction.model_dump())
        merged.update(result.model_dump())
        if risk is not None:
            merged.setdefault("risk_level", risk.risk_level)
            merged.setdefault("headline", risk.headline)
        merged["asked_questions"] = asked_questions
        merged["auto_advanced"] = request.timed_out
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


@app.post("/sensor-analyze")
async def sensor_analyze(request: SensorAnalyzeRequest) -> EventSourceResponse:
    """
    Sensor-pipeline entry point.

    Accepts a fused EvidenceObject + rule-based RiskAssessment (computed in the
    browser) plus optional caller text, builds a structured Gemini prompt from
    them, and streams the SAME SSE pipeline as /analyze. The risk assessment is
    forwarded to the CVL as a SensorPrior so high-confidence sensor evidence +
    live GPS can satisfy the location field.

    The existing /analyze endpoint is untouched for backward compatibility.
    """
    evidence_summary = _summarise_evidence(request.evidence)
    risk_summary = _summarise_risk(request.risk)
    sensor_prior = _sensor_prior_from(request)

    # On the very first request (no resume transcript yet) the "text" we feed the
    # pipeline is the composite [SENSOR EVIDENCE]/[RISK ASSESSMENT]/[CALLER
    # CONTEXT] prompt. On resume we keep using resume_transcript as-is, so the
    # follow-up loop (which appends Q/A pairs) works exactly like /analyze.
    composite_text = build_sensor_prompt(
        evidence_summary, risk_summary, request.text
    )

    analyze_request = AnalyzeRequest(
        text=composite_text,
        follow_up_responses=list(request.follow_up_responses),
        resume_transcript=request.resume_transcript,
        pending_question=request.pending_question,
        loops_used=request.loops_used,
        asked_questions=list(request.asked_questions),
        timed_out=request.timed_out,
    )

    # Forward the deterministic risk so the stream can emit ``risk_flagged``
    # immediately — only on the FIRST request (not when resuming a follow-up,
    # where the alert is already on screen and we just want to enrich/decide).
    risk_for_stream = request.risk if request.resume_transcript is None else None

    return EventSourceResponse(
        _analyze_stream(
            analyze_request,
            sensor_prior=sensor_prior,
            risk=risk_for_stream,
        )
    )


# ──────────────────────────────────────────────────────────────────────────────
# Deadline-crisis endpoints (added for the Vibe2Ship pivot).
#
# These reuse the SAME Gemini-client surface as the emergency pipeline
# (``make_gemini_client`` + ``PRIMARY_MODEL`` from extraction.py) and the SAME
# wide-open CORS. Each blocking Gemini call is dispatched with
# ``asyncio.to_thread`` so it never stalls the event loop, matching the
# non-blocking design used by /analyze. They live AFTER the existing endpoints
# and never touch them.
# ──────────────────────────────────────────────────────────────────────────────


def _strip_json_fences(raw: str) -> str:
    """
    Strip any accidental ```json … ``` markdown fences Gemini sometimes wraps
    around its JSON, returning the bare JSON text. Mirrors the same guard used
    inside ``run_deadline_cvl``.
    """
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


@app.post("/task-analyze", response_model=TaskAnalysisResponse)
async def analyze_task(task: TaskInput) -> TaskAnalysisResponse:
    """
    Run deadline CVL on a task. Returns urgency score + crisis level.
    Called every 60 seconds from the frontend to keep urgency live.
    """
    try:
        from datetime import datetime, timezone

        deadline_dt = datetime.fromisoformat(task.deadline_iso)
        # Match the deadline's timezone-awareness so naive ISO strings (no
        # offset, e.g. "2026-06-30T18:00:00") and aware ones both subtract
        # cleanly. A naive deadline -> a naive "now"; an aware deadline -> an
        # aware "now" in the same tz.
        if deadline_dt.tzinfo is None:
            now = datetime.now()
        else:
            now = datetime.now(deadline_dt.tzinfo)
        minutes_remaining = max(0, int((deadline_dt - now).total_seconds() / 60))

        client = make_gemini_client()
        if client is None:
            raise HTTPException(
                status_code=503,
                detail="GEMINI_API_KEY is not configured.",
            )

        # Run the (blocking) CVL in a worker thread so the event loop stays free.
        result = await asyncio.to_thread(
            run_deadline_cvl,
            task.title,
            task.description,
            minutes_remaining,
            task.estimated_minutes,
            task.context,
            client,
            PRIMARY_MODEL,
        )

        return TaskAnalysisResponse(
            urgency_score=result["urgency_score"],
            urgency_level=result["urgency_level"],
            minutes_remaining=minutes_remaining,
            will_miss_deadline=result["will_miss_deadline"],
            key_risk=result["key_risk"],
            cvl_iterations=result["cvl_iterations"],
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/rescue-plan", response_model=RescuePlanResponse)
async def generate_rescue_plan(req: RescuePlanRequest) -> RescuePlanResponse:
    """
    When urgency_score >= 0.75, generate a Gemini-powered rescue plan.
    Breaks the task into concrete timed micro-steps. Optionally drafts
    an email if the deadline will likely be missed.
    """
    try:
        client = make_gemini_client()
        if client is None:
            raise HTTPException(
                status_code=503,
                detail="GEMINI_API_KEY is not configured.",
            )

        prompt = f"""You are Override's Rescue Engine — a world-class productivity
AI that helps people complete tasks under extreme time pressure.

TASK: {req.title}
CONTEXT: {req.context or "general task"}
MINUTES REMAINING: {req.minutes_remaining}
ESTIMATED TIME NEEDED: {req.estimated_minutes} minutes
DEADLINE: {req.deadline_iso}

The user is in a DEADLINE CRISIS. Generate their rescue plan now.

Rules for micro_steps:
- Maximum 6 steps total
- Each step must be concrete and actionable (not "work on it")
- Steps must fit within time_remaining
- First step must start within 2 minutes
- If remaining < 30 min: 3-4 steps max, laser focused
- If remaining 30-90 min: 5-6 steps, balanced
- Include a "final check" step always

Also determine:
- If minutes_remaining < estimated_minutes * 0.6: draft an email for the user
- grounded_tip: one specific technique (Pomodoro, rubber duck, etc.) for this task type

Respond ONLY with valid JSON, no preamble, no markdown fences:
{{
  "micro_steps": [
    {{"order": 1, "title": "...", "duration_minutes": 10, "action": "..."}},
    ...
  ],
  "total_minutes": <sum of all durations>,
  "gemini_insight": "<one powerful, specific sentence of advice>",
  "needs_email": <true|false>,
  "email_subject": "<subject line if needs_email else null>",
  "email_body": "<full professional email body if needs_email else null>",
  "grounded_tip": "<specific productivity technique for this task type>"
}}"""

        response = await asyncio.to_thread(
            lambda: client.models.generate_content(
                model=PRIMARY_MODEL,
                contents=prompt,
            )
        )

        parsed = json.loads(_strip_json_fences(response.text))

        micro_steps = [MicroStep(**s) for s in parsed.get("micro_steps", [])]

        return RescuePlanResponse(
            micro_steps=micro_steps,
            total_minutes=parsed.get("total_minutes", req.minutes_remaining),
            gemini_insight=parsed.get(
                "gemini_insight", "Focus on completion over perfection."
            ),
            email_subject=parsed.get("email_subject"),
            email_body=parsed.get("email_body"),
            grounded_tip=parsed.get("grounded_tip"),
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/draft-email", response_model=EmailDraftResponse)
async def draft_deadline_email(req: EmailDraftRequest) -> EmailDraftResponse:
    """
    Standalone endpoint: draft a professional email for a missed/late deadline.
    """
    try:
        client = make_gemini_client()
        if client is None:
            raise HTTPException(
                status_code=503,
                detail="GEMINI_API_KEY is not configured.",
            )

        tone_map = {
            "professor": "respectful and formal",
            "manager": "professional and solution-focused",
            "client": "apologetic but confident",
            "team": "transparent and proactive",
        }
        tone = tone_map.get(req.recipient_type, "professional")

        prompt = f"""Draft a {tone} email for someone who will miss a deadline.

SITUATION:
- Task: {req.task_title}
- Recipient type: {req.recipient_type}
- Original deadline: {req.original_deadline}
- New ETA: {req.new_eta}
- Reason (optional): {req.reason or "unexpected workload"}

Requirements:
- Subject line: concise, honest, professional
- Body: under 120 words
- Tone: {tone}
- Must include: acknowledgment, brief reason, new ETA, commitment
- Must NOT: make excuses, over-apologize, be vague about new deadline
- End with a concrete next step

Respond ONLY with valid JSON:
{{
  "subject": "...",
  "body": "...",
  "tone": "{tone}"
}}"""

        response = await asyncio.to_thread(
            lambda: client.models.generate_content(
                model=PRIMARY_MODEL,
                contents=prompt,
            )
        )
        parsed = json.loads(_strip_json_fences(response.text))

        return EmailDraftResponse(
            subject=parsed["subject"],
            body=parsed["body"],
            tone=parsed.get("tone", tone),
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/")
async def root() -> dict[str, str]:
    """Tiny health/info endpoint."""
    return {
        "service": "Override — AI Emergency Decision Engine",
        "endpoint": "POST /analyze (text/event-stream)",
    }
