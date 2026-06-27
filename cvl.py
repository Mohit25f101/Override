"""
cvl.py — Confidence & Validation Layer for Override.

The Confidence & Validation Layer (CVL) is the safety gate that sits between
raw fact extraction and irreversible action. It answers three questions:

    1. Do we have enough evidence to act right now?
    2. If not, what single follow-up question buys us the most certainty?
    3. When do we stop asking and force a decision anyway?

It consumes an ``EmergencyExtraction`` (produced by ``extraction.py``), scores
the evidence against a fixed weighting scheme, and returns a structured
``ValidationResult`` describing the recommended next move.

Design principle: this layer NEVER blocks action indefinitely. After a bounded
number of clarification loops it forces a decision, because in an emergency a
late-but-safe action beats an endless interrogation.
"""

from typing import Optional

from pydantic import BaseModel

from extraction import EmergencyExtraction


# ──────────────────────────────────────────────────────────────────────────────
# Sensor-prior extension (added 2026-06-27).
#
# This is a SINGLE additional rule layered on top of — never inside — the fixed
# weighting scheme below. The weights and the 0.85/0.60/0.30 thresholds are NOT
# modified. The rule only governs whether the *location* field can be treated as
# satisfied by high-confidence sensor evidence.
#
# Rationale: when the browser sensor pipeline reports a Risk Assessment with very
# high confidence AND live GPS is available, the dispatcher effectively already
# has the victim's position. In that narrow case it is wasteful to keep asking
# "where are you?" — so we treat confirmed live GPS as equivalent to a confirmed
# human answer for the location field ONLY. It can never satisfy a vital
# (breathing / pulse / consciousness): those still require explicit evidence.
# ──────────────────────────────────────────────────────────────────────────────

# Confidence the rule-based Risk Engine must report before its location signal is
# trusted as a human-equivalent answer for the location field.
SENSOR_LOCATION_PRIOR_THRESHOLD: float = 0.90


class SensorPrior(BaseModel):
    """
    A compact prior derived from the browser sensor pipeline's Risk Engine.

    Passed (optionally) into ``validate``. Only ``risk_confidence`` and
    ``location_available`` participate in the single location-only extension
    rule; nothing here can satisfy a vital field.
    """

    risk_confidence: float = 0.0          # RiskAssessment.confidence, 0..1
    location_available: bool = False      # live GPS fix present


# ──────────────────────────────────────────────────────────────────────────────
# Fixed constants — DO NOT CHANGE.
# ──────────────────────────────────────────────────────────────────────────────

# Evidence weights. Breathing is the single most diagnostic signal, so it
# carries the heaviest weight. Consciousness and pulse are tied just below it.
WEIGHT_BREATHING: float = 0.30
WEIGHT_CONSCIOUS: float = 0.25
WEIGHT_PULSE: float = 0.25
WEIGHT_EMERGENCY_TYPE: float = 0.15
WEIGHT_LOCATION: float = 0.05

# Confidence band thresholds.
PROCEED_THRESHOLD: float = 0.85          # >= this  -> act immediately
ASK_THRESHOLD: float = 0.60              # >= this (and < PROCEED) -> ask once
                                         # < this  -> ask once + high uncertainty

# Hard cap on clarification rounds. After this many loops we stop asking and
# force a decision regardless of the confidence score.
MAX_VALIDATION_LOOPS: int = 2

# Exact follow-up question text, keyed by the field that is missing.
FOLLOW_UP_QUESTIONS: dict[str, str] = {
    "victim_breathing": "Is the person breathing normally right now?",
    "victim_conscious": "Is the person conscious and responding to you?",
    "victim_pulse_present": "Can you feel a pulse on their wrist or neck?",
    "emergency_type": "Can you describe what happened in one sentence?",
    "location_mentioned": "Where are you right now — a street name or landmark?",
}

# Ordered highest-weight-first. Ties (conscious/pulse) are broken in this fixed
# order so question selection is deterministic. The order here drives both the
# "highest-weight missing field" selection and the missing_fields ordering.
FIELD_PRIORITY: list[tuple[str, float]] = [
    ("victim_breathing", WEIGHT_BREATHING),
    ("victim_conscious", WEIGHT_CONSCIOUS),
    ("victim_pulse_present", WEIGHT_PULSE),
    ("emergency_type", WEIGHT_EMERGENCY_TYPE),
    ("location_mentioned", WEIGHT_LOCATION),
]


# ──────────────────────────────────────────────────────────────────────────────
# Return type.
# ──────────────────────────────────────────────────────────────────────────────

class ValidationResult(BaseModel):
    confidence: float                    # weighted_sum * raw_confidence, capped 1.0
    confidence_band: str                 # "PROCEED", "ASK_ONE", or "UNCERTAIN"
    proceed: bool                        # True if confidence >= PROCEED_THRESHOLD
    follow_up_question: Optional[str]    # None when proceeding or forced
    missing_fields: list[str]            # names of fields that are None / Unknown
    loops_used: int                      # how many clarification loops have run
    forced: bool                         # True if we hit MAX_VALIDATION_LOOPS
    high_uncertainty: bool               # True if confidence < ASK_THRESHOLD
    warning: Optional[str]               # populated on forced decisions
    action_ready: bool                   # True if proceed OR forced


# ──────────────────────────────────────────────────────────────────────────────
# Helpers.
# ──────────────────────────────────────────────────────────────────────────────

def _is_present(field_name: str, extraction: EmergencyExtraction) -> bool:
    """
    Return True if a field counts as 'present evidence'.

    - Booleans (breathing / conscious / pulse): present if not None.
      Both True and False count as evidence; only None counts as missing.
    - emergency_type: present only if it is not "Unknown".
    - location_mentioned: present only if it is not None.
    """
    if field_name == "emergency_type":
        return extraction.emergency_type != "Unknown"
    value = getattr(extraction, field_name)
    return value is not None


def _location_satisfied_by_sensor(sensor_prior: Optional["SensorPrior"]) -> bool:
    """
    Single, isolated extension rule (location field ONLY).

    Returns True when a high-confidence Risk Assessment is paired with live GPS,
    in which case the location field is treated as satisfied (a human-equivalent
    answer). This never touches vitals and never changes any weight or threshold.
    """
    if sensor_prior is None:
        return False
    return (
        sensor_prior.location_available
        and sensor_prior.risk_confidence >= SENSOR_LOCATION_PRIOR_THRESHOLD
    )


def _missing_fields(
    extraction: EmergencyExtraction,
    sensor_prior: Optional["SensorPrior"] = None,
) -> list[str]:
    """
    Names of evidence fields that are NOT present, in weight-priority order.

    For location we honour the spec's relaxation: location is considered
    satisfied if a location is mentioned OR there is more than one victim OR —
    via the isolated sensor-prior extension — high-confidence sensor evidence
    plus live GPS is available. It is only reported missing when ALL of those
    fail.
    """
    location_by_sensor = _location_satisfied_by_sensor(sensor_prior)
    missing: list[str] = []
    for field_name, _weight in FIELD_PRIORITY:
        if field_name == "location_mentioned":
            if (
                extraction.location_mentioned is None
                and extraction.victim_count <= 1
                and not location_by_sensor
            ):
                missing.append(field_name)
        elif not _is_present(field_name, extraction):
            missing.append(field_name)
    return missing


# ──────────────────────────────────────────────────────────────────────────────
# Core scoring.
# ──────────────────────────────────────────────────────────────────────────────

def calculate_confidence(
    extraction: EmergencyExtraction,
    sensor_prior: Optional["SensorPrior"] = None,
) -> float:
    """
    Compute the weighted, raw-confidence-scaled evidence score.

    Steps:
      1. Sum the weights of every field that is present (see _is_present).
      2. emergency_type contributes 0.15 only when it is not "Unknown".
      3. location contributes 0.05 when location_mentioned is not None
         OR victim_count > 1 OR (isolated sensor-prior extension) high-confidence
         sensor evidence plus live GPS is available.
      4. Multiply the weighted sum by extraction.raw_confidence.
      5. Cap the final value at 1.0.

    The weights themselves are UNCHANGED; the sensor prior only changes whether
    the existing WEIGHT_LOCATION term is counted as present — and nothing else.
    """
    weighted_sum = 0.0

    if _is_present("victim_breathing", extraction):
        weighted_sum += WEIGHT_BREATHING
    if _is_present("victim_conscious", extraction):
        weighted_sum += WEIGHT_CONSCIOUS
    if _is_present("victim_pulse_present", extraction):
        weighted_sum += WEIGHT_PULSE
    if extraction.emergency_type != "Unknown":
        weighted_sum += WEIGHT_EMERGENCY_TYPE
    if (
        extraction.location_mentioned is not None
        or extraction.victim_count > 1
        or _location_satisfied_by_sensor(sensor_prior)
    ):
        weighted_sum += WEIGHT_LOCATION

    confidence = weighted_sum * extraction.raw_confidence
    return min(confidence, 1.0)


def _select_follow_up(
    extraction: EmergencyExtraction,
    sensor_prior: Optional["SensorPrior"] = None,
) -> Optional[str]:
    """
    Return the follow-up question for the highest-weight missing field.

    FIELD_PRIORITY is ordered highest-weight-first, so the first missing field
    we encounter is the most valuable one to ask about. Returns None if nothing
    is missing.
    """
    for field_name, _weight in _iter_missing_in_priority(extraction, sensor_prior):
        return FOLLOW_UP_QUESTIONS[field_name]
    return None


def _iter_missing_in_priority(
    extraction: EmergencyExtraction,
    sensor_prior: Optional["SensorPrior"] = None,
):
    """Yield (field_name, weight) for missing fields, highest weight first."""
    missing = set(_missing_fields(extraction, sensor_prior))
    for field_name, weight in FIELD_PRIORITY:
        if field_name in missing:
            yield field_name, weight


# ──────────────────────────────────────────────────────────────────────────────
# Public entry point.
# ──────────────────────────────────────────────────────────────────────────────

def validate(
    extraction: EmergencyExtraction,
    loops_used: int = 0,
    sensor_prior: Optional["SensorPrior"] = None,
) -> ValidationResult:
    """
    Decide whether to PROCEED, ASK one follow-up, or FORCE a decision.

    Args:
        extraction:   the extracted emergency facts to evaluate.
        loops_used:   how many clarification loops have already run. The caller
                      increments this each time it re-invokes validate() after
                      asking a follow-up question.
        sensor_prior: optional Risk-Engine prior from the browser sensor
                      pipeline. Used ONLY by the isolated location-field
                      extension rule; it can never satisfy a vital and never
                      changes any weight or threshold.

    Returns:
        A fully populated ValidationResult.
    """
    confidence = calculate_confidence(extraction, sensor_prior)
    missing = _missing_fields(extraction, sensor_prior)

    proceed = confidence >= PROCEED_THRESHOLD
    high_uncertainty = confidence < ASK_THRESHOLD

    # ── Case 1: enough evidence — act now. ───────────────────────────────────
    if proceed:
        return ValidationResult(
            confidence=confidence,
            confidence_band="PROCEED",
            proceed=True,
            follow_up_question=None,
            missing_fields=missing,
            loops_used=loops_used,
            forced=False,
            high_uncertainty=False,
            warning=None,
            action_ready=True,
        )

    # ── Case 2: out of loops — force a decision rather than keep asking. ──────
    if loops_used >= MAX_VALIDATION_LOOPS:
        return ValidationResult(
            confidence=confidence,
            confidence_band="UNCERTAIN" if high_uncertainty else "ASK_ONE",
            proceed=False,
            follow_up_question=None,           # stop asking
            missing_fields=missing,
            loops_used=loops_used,
            forced=True,
            high_uncertainty=high_uncertainty,
            warning="Low confidence — treat as cardiac emergency until confirmed.",
            action_ready=True,                 # forced action is still action
        )

    # ── Case 3: nothing left to ask — force a decision. ───────────────────────
    #    Every tracked field is already present, yet a low raw_confidence keeps
    #    the score below PROCEED_THRESHOLD. There is no missing field to target,
    #    so _select_follow_up() would return None. Returning forced=False /
    #    action_ready=False here would hand the caller neither a question nor an
    #    action, stalling validation unless it artificially burns a loop. Since
    #    asking again cannot improve evidence completeness (nothing is missing),
    #    we force a decision now instead of looping pointlessly.
    if not missing:
        return ValidationResult(
            confidence=confidence,
            confidence_band="UNCERTAIN" if high_uncertainty else "ASK_ONE",
            proceed=False,
            follow_up_question=None,           # nothing left to ask
            missing_fields=missing,
            loops_used=loops_used,
            forced=True,
            high_uncertainty=high_uncertainty,
            warning="Low confidence — treat as cardiac emergency until confirmed.",
            action_ready=True,                 # forced action is still action
        )

    # ── Case 4: not confident yet, loops remain — ask one question. ──────────
    band = "UNCERTAIN" if high_uncertainty else "ASK_ONE"
    return ValidationResult(
        confidence=confidence,
        confidence_band=band,
        proceed=False,
        follow_up_question=_select_follow_up(extraction, sensor_prior),
        missing_fields=missing,
        loops_used=loops_used,
        forced=False,
        high_uncertainty=high_uncertainty,
        warning=None,
        action_ready=False,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Self-test block.
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":

    def _show(label: str, result: ValidationResult) -> None:
        print(f"\n=== {label} ===")
        print(f"  confidence       : {result.confidence:.4f}")
        print(f"  confidence_band  : {result.confidence_band}")
        print(f"  proceed          : {result.proceed}")
        print(f"  follow_up        : {result.follow_up_question}")
        print(f"  missing_fields   : {result.missing_fields}")
        print(f"  loops_used       : {result.loops_used}")
        print(f"  forced           : {result.forced}")
        print(f"  high_uncertainty : {result.high_uncertainty}")
        print(f"  warning          : {result.warning}")
        print(f"  action_ready     : {result.action_ready}")

    # ──────────────────────────────────────────────────────────────────────
    # Test 1: all three vitals are None -> follow-up should target breathing
    #         (the highest-weight missing field).
    # ──────────────────────────────────────────────────────────────────────
    test1 = EmergencyExtraction(
        emergency_type="Cardiac",
        victim_conscious=None,
        victim_breathing=None,
        victim_pulse_present=None,
        chest_pain_reported=None,
        location_mentioned="123 Main St",
        victim_count=1,
        raw_confidence=0.9,
        reasoning="Vitals unknown; only type and location confirmed.",
    )
    r1 = validate(test1, loops_used=0)
    _show("Test 1: missing vitals -> ask about breathing", r1)
    assert r1.follow_up_question == FOLLOW_UP_QUESTIONS["victim_breathing"], \
        "Test 1 FAILED: expected breathing follow-up."
    assert r1.proceed is False, "Test 1 FAILED: should not proceed."
    assert "victim_breathing" in r1.missing_fields, \
        "Test 1 FAILED: breathing should be missing."
    print("  -> PASSED")

    # ──────────────────────────────────────────────────────────────────────
    # Test 2: every field filled, raw_confidence=0.90 -> PROCEED immediately.
    #         weighted_sum = 1.0, confidence = 0.90 >= 0.85.
    # ──────────────────────────────────────────────────────────────────────
    test2 = EmergencyExtraction(
        emergency_type="Cardiac",
        victim_conscious=True,
        victim_breathing=True,
        victim_pulse_present=True,
        chest_pain_reported=True,
        location_mentioned="123 Main St",
        victim_count=1,
        raw_confidence=0.90,
        reasoning="All critical fields confirmed by caller.",
    )
    r2 = validate(test2, loops_used=0)
    _show("Test 2: all fields filled -> PROCEED", r2)
    assert r2.proceed is True, "Test 2 FAILED: should proceed."
    assert r2.confidence_band == "PROCEED", "Test 2 FAILED: band should be PROCEED."
    assert r2.follow_up_question is None, "Test 2 FAILED: no follow-up expected."
    assert r2.action_ready is True, "Test 2 FAILED: should be action-ready."
    assert abs(r2.confidence - 0.90) < 1e-9, \
        f"Test 2 FAILED: expected 0.90, got {r2.confidence}."
    print("  -> PASSED")

    # ──────────────────────────────────────────────────────────────────────
    # Test 3: call validate() with incrementing loops_used and confirm
    #         forced=True fires once we hit MAX_VALIDATION_LOOPS (2).
    #         Low-confidence extraction keeps us below PROCEED throughout.
    # ──────────────────────────────────────────────────────────────────────
    test3 = EmergencyExtraction(
        emergency_type="Unknown",
        victim_conscious=None,
        victim_breathing=None,
        victim_pulse_present=None,
        chest_pain_reported=None,
        location_mentioned=None,
        victim_count=1,
        raw_confidence=0.3,
        reasoning="Almost nothing confirmed; very low confidence.",
    )

    r3_loop0 = validate(test3, loops_used=0)
    _show("Test 3a: loop 0 -> still asking", r3_loop0)
    assert r3_loop0.forced is False, "Test 3a FAILED: should not be forced yet."
    assert r3_loop0.action_ready is False, "Test 3a FAILED: not action-ready yet."
    assert r3_loop0.follow_up_question is not None, \
        "Test 3a FAILED: expected a follow-up question."

    r3_loop1 = validate(test3, loops_used=1)
    _show("Test 3b: loop 1 -> still asking", r3_loop1)
    assert r3_loop1.forced is False, "Test 3b FAILED: should not be forced yet."
    assert r3_loop1.follow_up_question is not None, \
        "Test 3b FAILED: expected a follow-up question."

    r3_loop2 = validate(test3, loops_used=2)
    _show("Test 3c: loop 2 -> forced decision", r3_loop2)
    assert r3_loop2.forced is True, "Test 3c FAILED: forced should fire at loop 2."
    assert r3_loop2.action_ready is True, \
        "Test 3c FAILED: forced decision must be action-ready."
    assert r3_loop2.follow_up_question is None, \
        "Test 3c FAILED: must stop asking once forced."
    assert r3_loop2.warning == \
        "Low confidence — treat as cardiac emergency until confirmed.", \
        "Test 3c FAILED: missing/incorrect forced-decision warning."
    assert r3_loop2.high_uncertainty is True, \
        "Test 3c FAILED: low confidence should flag high_uncertainty."
    print("  -> PASSED")

    # ──────────────────────────────────────────────────────────────────────
    # Test 4: every tracked field is present, but raw_confidence is low enough
    #         to keep the score below PROCEED_THRESHOLD. There is nothing left
    #         to ask, so validate() must FORCE a decision (forced=True,
    #         action_ready=True, no follow-up) on the very first loop instead of
    #         stalling with neither a question nor an action.
    #         weighted_sum = 1.0, confidence = 1.0 * 0.5 = 0.5 (< 0.85).
    # ──────────────────────────────────────────────────────────────────────
    test4 = EmergencyExtraction(
        emergency_type="Cardiac",
        victim_conscious=True,
        victim_breathing=True,
        victim_pulse_present=True,
        chest_pain_reported=True,
        location_mentioned="123 Main St",
        victim_count=1,
        raw_confidence=0.50,
        reasoning="All fields present but model is only moderately confident.",
    )
    r4 = validate(test4, loops_used=0)
    _show("Test 4: all fields present, low confidence -> forced", r4)
    assert r4.missing_fields == [], \
        "Test 4 FAILED: no fields should be missing."
    assert r4.proceed is False, "Test 4 FAILED: should not proceed below threshold."
    assert r4.forced is True, \
        "Test 4 FAILED: must force when nothing is left to ask."
    assert r4.action_ready is True, \
        "Test 4 FAILED: forced decision must be action-ready."
    assert r4.follow_up_question is None, \
        "Test 4 FAILED: there is no field left to ask about."
    assert r4.warning is not None, \
        "Test 4 FAILED: forced decision should carry a warning."
    print("  -> PASSED")

    # ──────────────────────────────────────────────────────────────────────
    # Test 5: sensor-prior extension (location field ONLY).
    #   Vitals all confirmed, but location is NOT mentioned and victim_count=1,
    #   so without a sensor prior location is missing. With a high-confidence
    #   Risk Assessment + live GPS, the location field is satisfied, the
    #   WEIGHT_LOCATION term counts, and confidence reaches PROCEED.
    # ──────────────────────────────────────────────────────────────────────
    test5 = EmergencyExtraction(
        emergency_type="Cardiac",
        victim_conscious=True,
        victim_breathing=True,
        victim_pulse_present=True,
        chest_pain_reported=True,
        location_mentioned=None,     # caller never stated a location
        victim_count=1,
        raw_confidence=0.90,
        reasoning="All vitals confirmed; location only known via GPS.",
    )

    # Without the prior: location missing, weighted_sum = 0.95, conf = 0.855.
    r5_no_prior = validate(test5, loops_used=0, sensor_prior=None)
    _show("Test 5a: no sensor prior -> location missing", r5_no_prior)
    assert "location_mentioned" in r5_no_prior.missing_fields, \
        "Test 5a FAILED: location should be missing without a sensor prior."

    # With a high-confidence prior + live GPS: location satisfied, weighted_sum
    # = 1.0, confidence = 0.90 -> PROCEED, and location is no longer missing.
    prior = SensorPrior(risk_confidence=0.95, location_available=True)
    r5_prior = validate(test5, loops_used=0, sensor_prior=prior)
    _show("Test 5b: sensor prior satisfies location", r5_prior)
    assert "location_mentioned" not in r5_prior.missing_fields, \
        "Test 5b FAILED: live GPS + high risk confidence should satisfy location."
    assert r5_prior.confidence > r5_no_prior.confidence, \
        "Test 5b FAILED: satisfying location should raise confidence."

    # The prior must NEVER rescue a missing vital. Drop breathing to None: even
    # with a perfect prior, breathing stays missing and we do not PROCEED.
    test5_no_breath = test5.model_copy(update={"victim_breathing": None})
    r5_vital = validate(test5_no_breath, loops_used=0, sensor_prior=prior)
    _show("Test 5c: prior cannot satisfy a vital", r5_vital)
    assert "victim_breathing" in r5_vital.missing_fields, \
        "Test 5c FAILED: sensor prior must never satisfy a vital field."
    print("  -> PASSED")

    print("\nAll tests passed.")
