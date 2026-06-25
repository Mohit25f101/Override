"""
verify_setup.py — Pre-flight check for environment configuration.

Run this script to confirm the project is correctly configured before
starting the main application.

    python verify_setup.py
"""

import sys
import os
from pathlib import Path

ROOT = Path(__file__).parent

PASS = "[OK]"
FAIL = "[XX]"
WARN = "[!!]"

checks_passed = True


def check(label: str, condition: bool, fix: str = "") -> bool:
    if condition:
        print(f"  {PASS}  {label}")
    else:
        print(f"  {FAIL}  {label}")
        if fix:
            print(f"       -> {fix}")
    return condition


print("\n==========================================")
print("   Environment Configuration Verification")
print("==========================================\n")

# 1. .env file exists
env_exists = (ROOT / ".env").exists()
checks_passed &= check(
    ".env file exists",
    env_exists,
    "Create a .env file in the project root."
)

# 2. .gitignore ignores .env
gitignore_path = ROOT / ".gitignore"
gitignore_ok = False
if gitignore_path.exists():
    content = gitignore_path.read_text()
    gitignore_ok = ".env" in content
checks_passed &= check(
    ".env is listed in .gitignore",
    gitignore_ok,
    "Add '.env' to .gitignore to prevent accidental commits."
)

# 3. python-dotenv is importable
try:
    import dotenv  # noqa: F401
    dotenv_ok = True
except ImportError:
    dotenv_ok = False
checks_passed &= check(
    "python-dotenv is installed",
    dotenv_ok,
    "Run: pip install python-dotenv"
)

# 4. GEMINI_API_KEY loads and is not the placeholder
key_ok = False
key_placeholder = False
if env_exists and dotenv_ok:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env", override=True)
    raw_key = os.getenv("GEMINI_API_KEY", "")
    placeholder = "your_gemini_api_key_here"
    key_placeholder = raw_key == placeholder
    key_ok = bool(raw_key) and not key_placeholder

if key_placeholder:
    checks_passed &= check(
        "GEMINI_API_KEY is set (not placeholder)",
        False,
        "Edit .env and replace 'your_gemini_api_key_here' with your real key."
    )
else:
    checks_passed &= check(
        "GEMINI_API_KEY is set (not placeholder)",
        key_ok,
        "Add GEMINI_API_KEY=<your_key> to the .env file."
    )

print()
if checks_passed:
    print("  [OK]  All checks passed! Environment is ready.\n")
    sys.exit(0)
else:
    print("  [XX]  One or more checks failed. Fix the issues above, then re-run.\n")
    sys.exit(1)
