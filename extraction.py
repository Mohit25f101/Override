import json
import os
from typing import Optional

import google.generativeai as genai
from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError


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


SYSTEM_PROMPT = (
    "You are an emergency triage AI. Given an emergency input, extract all observable facts\n"
    "and return ONLY valid JSON. If a field cannot be confirmed from the input, set it to null.\n"
    "Do NOT assume or guess facts not stated. Set raw_confidence between 0.0 and 1.0 based on\n"
    "how many critical fields (breathing, pulse, consciousness) you can confirm from the input alone.\n"
    "Lower confidence when critical fields are missing.\n"
    "\n"
    "The input may be a running transcript that mixes the caller's free-text report with\n"
    "labelled clarification exchanges in the form:\n"
    "    Q: <a question that was asked>\n"
    "    A: <the caller's answer>\n"
    "Each 'A:' answers the immediately preceding 'Q:'. Use the question to interpret short or\n"
    "terse answers (e.g. 'No', 'Yes', 'Not sure') and map them to the correct field. For example,\n"
    "'Q: Is the person breathing normally right now?\\nA: No' confirms that the victim is NOT\n"
    "breathing (victim_breathing = false), and 'A: Yes' to that question confirms breathing is\n"
    "present (victim_breathing = true). Treat a confirmed 'false' as evidence, not as missing data."
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


def _call_model(model_name: str, text: str) -> str:
    model = genai.GenerativeModel(
        model_name=model_name,
        system_instruction=SYSTEM_PROMPT,
        generation_config={"response_mime_type": "application/json"},
    )
    response = model.generate_content(text)
    if not getattr(response, "text", None):
        raise ValueError("Gemini returned an empty response.")
    return response.text


def extract_emergency(text: str) -> EmergencyExtraction:
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return _fallback_extraction()

    genai.configure(api_key=api_key)

    try:
        raw_json = _call_model("gemini-2.0-flash", text)
    except Exception:
        try:
            raw_json = _call_model("gemini-1.5-flash", text)
        except Exception:
            return _fallback_extraction()

    try:
        parsed = json.loads(raw_json)
        return EmergencyExtraction.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError, TypeError, ValueError):
        return _fallback_extraction()


if __name__ == "__main__":
    test_input = "My dad just collapsed in the living room, he's not breathing and I can't feel a pulse"
    result = extract_emergency(test_input)
    print(result)
