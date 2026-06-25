"""
config.py — Centralized environment configuration.

Loads environment variables from .env and exposes validated settings
to the rest of the application. Import GEMINI_API_KEY from here instead
of reading os.environ directly anywhere else.
"""

from dotenv import load_dotenv
import os

# Load variables from .env into the process environment.
# This is a no-op if .env doesn't exist, so the explicit check below
# provides a clear error rather than a silent failure.
load_dotenv()

GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")

# ── Validation ────────────────────────────────────────────────────────────────

if not GEMINI_API_KEY or GEMINI_API_KEY == "your_gemini_api_key_here":
    raise EnvironmentError(
        "\n"
        "╔══════════════════════════════════════════════════════════════╗\n"
        "║              GEMINI_API_KEY is not configured                ║\n"
        "╠══════════════════════════════════════════════════════════════╣\n"
        "║  1. Open the '.env' file in the project root.               ║\n"
        "║  2. Replace the placeholder with your real API key:         ║\n"
        "║                                                              ║\n"
        "║     GEMINI_API_KEY=AIza...your_real_key_here                ║\n"
        "║                                                              ║\n"
        "║  3. Get a key at: https://aistudio.google.com/app/apikey   ║\n"
        "║  4. Never commit .env to source control.                    ║\n"
        "╚══════════════════════════════════════════════════════════════╝\n"
    )
