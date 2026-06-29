"""
extraction.py — Gemini fact-extraction for Override.

Takes an emergency input (free text and/or a structured evidence + risk summary
coming from the browser sensor pipeline) and returns a typed
``EmergencyExtraction`` of observable facts.

Model chain (updated 2026-06-27 — the old gemini-2.0/1.5 names 404 as of
2026-06-01):

    PRIMARY  : gemini-3.5-flash       (GA since 2026-05-19)
    FALLBACK : gemini-3.1-flash-lite  (stable)

SDK note (updated 2026-06-29): migrated from the deprecated
``google-generativeai`` package to the unified ``google-genai`` SDK. We now use
``genai.Client(api_key=...)`` and ``client.models.generate_content(...)`` instead
of the old ``genai.configure`` + ``genai.GenerativeModel`` surface.

Design rules:
  * The Gemini API key is read from the environment (GEMINI_API_KEY). It is
    NEVER hardcoded. If it is missing we log a warning and return a fallback
    extraction instead of crashing.
  * Every generate_content call carries a hard HTTP timeout so a hung network
    call can never stall the SSE pipeline.
  * If the input text is empty/whitespace we short-circuit to the fallback
    without calling Gemini at all (no point spending a request on nothing).
  * Gemini only ever sees a structured EvidenceObject summary + RiskAssessment
    summary + the caller's free text — never raw sensor objects.
"""

import json
import logging
import os
from typing import Optional

from google import genai
from google.genai import types
from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError, field_validator


logger = logging.getLogger("override.extraction")

# Model chain. PRIMARY first, FALLBACK second. Centralised so there is a single
# place to update when Google rotates model names again.
PRIMARY_MODEL = "gemini-3.1-flash-lite"
FALLBACK_MODEL = "gemini-3.5-flash"

# Every Gemini call uses this timeout (seconds) so a hung request cannot stall
# the emergency pipeline.
REQUEST_TIMEOUT_SECONDS = 20


class EmergencyExtraction(BaseModel):
    emergency_type: str
    victim_conscious: Optional[bool]
    victim_breathing: Optional[bool]
    victim_pulse_present: Optional[bool]
    chest_pain_reported: Optional[bool]
    location_mentioned: Optional[str]
    victim_count: int = 1
    raw_confidence: float
    reasoning: str

    @field_validator("victim_count", mode="before")
    @classmethod
    def _coerce_victim_count(cls, v: object) -> int:
        """
        Gemini sometimes returns victim_count as null or a string. The CVL
        relies on an integer (location relaxation checks victim_count > 1), so
        coerce anything non-integer-like back to the safe default of 1 rather
        than failing validation and discarding an otherwise-good extraction.
        """
        if v is None:
            return 1
        try:
            return int(v)
        except (TypeError, ValueError):
            return 1


SYSTEM_PROMPT = (
    "You are an emergency triage FACT-EXTRACTION engine operating under a strict\n"
    "ZERO-HALLUCINATION, HIGH-URGENCY protocol. You are NOT a chatbot. You are\n"
    "NOT conversational, cheerful, reassuring, or chatty. You output ONLY facts\n"
    "as valid JSON — never advice, never small talk, never invented details.\n"
    "\n"
    "ABSOLUTE RULES (violating any of these is a critical failure):\n"
    "  1. NEVER invent or guess a fact that is not explicitly present in the\n"
    "     input. If something is not stated or sensed, the field is null.\n"
    "  2. NEVER infer a vital (breathing / pulse / consciousness) from sensor\n"
    "     data. A motion spike, loud noise, or stillness does NOT tell you\n"
    "     whether someone is breathing. Those fields stay null until a human\n"
    "     answer confirms them.\n"
    "  3. When uncertain, prefer null and a LOWER raw_confidence. Under-claiming\n"
    "     is safe; over-claiming is dangerous.\n"
    "  4. Keep `reasoning` to ONE short factual sentence. No reassurance, no\n"
    "     speculation, no instructions to the caller.\n"
    "\n"
    "You are given structured emergency evidence synthesised from a phone's\n"
    "sensors, an automated rule-based risk assessment, and (optionally) free-text\n"
    "context from the caller. Your job is to extract all observable facts and\n"
    "return ONLY valid JSON.\n"
    "\n"
    "The input may contain three labelled sections, any of which can be absent:\n"
    "    [SENSOR EVIDENCE]   — a summary of fused device-sensor readings\n"
    "                          (motion spike, GPS speed, audio level, battery,\n"
    "                          whether the device is stationary). Some values may\n"
    "                          be marked DEMO (simulated) — treat them as evidence\n"
    "                          but do not over-trust a single simulated value.\n"
    "    [RISK ASSESSMENT]   — a transparent rule-based triage (risk level,\n"
    "                          suspected emergency type, which rules fired). Use it\n"
    "                          as a strong prior for emergency_type, but only the\n"
    "                          caller's words/sensors can confirm the vitals.\n"
    "    [CALLER CONTEXT]    — the caller's own free-text or spoken report.\n"
    "\n"
    "Rules for filling fields:\n"
    "  * If a vital (breathing / pulse / consciousness) cannot be CONFIRMED from\n"
    "    the input, set it to null. Do NOT guess vitals from sensor data alone —\n"
    "    a motion spike does not tell you whether someone is breathing.\n"
    "  * emergency_type may be inferred from the risk assessment + sensors even\n"
    "    without caller text (e.g. a fall/impact pattern -> 'Possible fall/impact').\n"
    "  * location_mentioned: if [SENSOR EVIDENCE] says GPS location is available,\n"
    "    set location_mentioned to a short string like 'GPS coordinates available'\n"
    "    rather than null, because the dispatcher already has the position.\n"
    "  * Set raw_confidence between 0.0 and 1.0 based on how many critical fields\n"
    "    (breathing, pulse, consciousness) you can confirm from the input alone.\n"
    "    Lower it when critical vitals are missing.\n"
    "\n"
    "The caller context may be a running transcript that mixes the free-text\n"
    "report with labelled clarification exchanges in the form:\n"
    "    Q: <a question that was asked>\n"
    "    A: <the caller's answer>\n"
    "Each 'A:' answers the immediately preceding 'Q:'. Use the question to\n"
    "interpret short answers (e.g. 'No', 'Yes', 'Not sure') and map them to the\n"
    "correct field. For example, 'Q: Is the person breathing normally right now?\\n"
    "A: No' confirms the victim is NOT breathing (victim_breathing = false), and\n"
    "'A: Yes' confirms breathing is present (victim_breathing = true). Treat a\n"
    "confirmed 'false' as evidence, not as missing data.\n"
    "\n"
    "Return JSON with exactly these keys: emergency_type, victim_conscious,\n"
    "victim_breathing, victim_pulse_present, chest_pain_reported,\n"
    "location_mentioned, victim_count, raw_confidence, reasoning."
)


def _fallback_extraction() -> EmergencyExtraction:
    return EmergencyExtraction(
        emergency_type="Unknown",
        victim_conscious=None,
        victim_breathing=None,
        victim_pulse_present=None,
        chest_pain_reported=None,
        location_mentioned=None,
        victim_count=1,
        raw_confidence=0.1,
        reasoning="Extraction failed",
    )


def _call_model(client: "genai.Client", model_name: str, text: str) -> str:
    # The GenerateContentConfig carries the system instruction and forces a JSON
    # response. The hard HTTP timeout lives on the client (see extract_emergency)
    # so a hung call cannot stall the SSE pipeline.
    response = client.models.generate_content(
        model=model_name,
        contents=text,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
        ),
    )
    if not getattr(response, "text", None):
        raise ValueError("Gemini returned an empty response.")
    return response.text


def extract_emergency(text: str) -> EmergencyExtraction:
    """
    Extract structured emergency facts from ``text``.

    ``text`` may be plain caller free-text, or a composite prompt containing
    [SENSOR EVIDENCE] / [RISK ASSESSMENT] / [CALLER CONTEXT] sections built by
    ``build_sensor_prompt``. Either way Gemini only ever sees text — never raw
    sensor objects.
    """
    # Empty-text guard: never spend a Gemini request on nothing.
    if not text or not text.strip():
        logger.warning("extract_emergency called with empty input — using fallback.")
        return _fallback_extraction()

    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.warning(
            "GEMINI_API_KEY is not set — returning fallback extraction "
            "instead of calling Gemini."
        )
        return _fallback_extraction()

    # The google-genai SDK takes the HTTP timeout (in milliseconds) via
    # http_options on the client, replacing the old per-call request_options.
    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_SECONDS * 1000),
    )

    raw_json: Optional[str] = None
    try:
        raw_json = _call_model(client, PRIMARY_MODEL, text)
    except Exception as primary_exc:  # noqa: BLE001 — fall back on any failure.
        logger.warning(
            "Primary model %s failed (%s) — falling back to %s.",
            PRIMARY_MODEL,
            primary_exc,
            FALLBACK_MODEL,
        )
        try:
            raw_json = _call_model(client, FALLBACK_MODEL, text)
        except Exception as fallback_exc:  # noqa: BLE001
            logger.warning(
                "Fallback model %s also failed (%s) — returning fallback "
                "extraction.",
                FALLBACK_MODEL,
                fallback_exc,
            )
            return _fallback_extraction()

    try:
        parsed = json.loads(raw_json)
        return EmergencyExtraction.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError, TypeError, ValueError) as parse_exc:
        logger.warning(
            "Could not parse/validate Gemini JSON (%s) — returning fallback "
            "extraction.",
            parse_exc,
        )
        return _fallback_extraction()


def build_sensor_prompt(
    evidence_summary: Optional[str],
    risk_summary: Optional[str],
    text: Optional[str],
) -> str:
    """
    Compose the labelled prompt sent to Gemini for the sensor pipeline.

    Only non-empty sections are included. If everything is empty the returned
    string is empty, which makes ``extract_emergency`` short-circuit to the
    fallback via its empty-text guard.
    """
    sections: list[str] = []
    if evidence_summary and evidence_summary.strip():
        sections.append(f"[SENSOR EVIDENCE]\n{evidence_summary.strip()}")
    if risk_summary and risk_summary.strip():
        sections.append(f"[RISK ASSESSMENT]\n{risk_summary.strip()}")
    if text and text.strip():
        sections.append(f"[CALLER CONTEXT]\n{text.strip()}")
    return "\n\n".join(sections)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    test_input = (
        "My dad just collapsed in the living room, he's not breathing and "
        "I can't feel a pulse"
    )
    result = extract_emergency(test_input)
    print(result)
