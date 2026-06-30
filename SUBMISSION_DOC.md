# Override — Hackathon Submission

> Paste this content into a Google Doc, then set sharing to
> **"Anyone with the link → Viewer"** and confirm it opens in an incognito window.

---

## 1. Problem Statement Selected

**"The Last-Minute Life Saver"**

---

## 2. Solution Overview

Override refuses to dispatch any emergency action until the collected evidence
crosses a validated confidence threshold (≥ 85%), because in an emergency a
wrong action is worse than a slow one. Chaotic text input is parsed
into a strict set of observable clinical facts, scored by a Confidence &
Validation Layer (CVL) that heavily penalizes missing critical signals
(breathing, pulse, consciousness). When confidence is too low it asks a single
targeted follow-up question instead of guessing, and only then surfaces a
severity-coded action dashboard.

---

## 3. Key Features

*(Confirmed against the actual code — main.py, cvl.py, extraction.py,
app/page.tsx, app/dashboard/page.tsx.)*

- **Confidence-scored validation loop (CVL).** `cvl.py` scores evidence against
  a fixed weighting scheme (breathing 0.30, conscious 0.25, pulse 0.25, type
  0.15, location 0.05) and only proceeds at ≥ 0.85.
- **Interactive follow-up.** When confidence is low and no pre-supplied answer
  exists, the SSE stream pauses with an `awaiting_follow_up` event and resumes
  on the user's answer (root-cause fix in `main.py` so the same question never
  loops forever). The UI prompt lives in `app/page.tsx`.
- **Streaming pipeline.** `POST /analyze` streams each stage (received →
  extracting → extracted → validating → follow_up → decision → complete) over
  Server-Sent Events, rendered live by the `Pipeline` component.
- **Severity derivation kept separate from validation confidence.** The
  dashboard (`deriveClinicalState` in `app/dashboard/page.tsx`) derives clinical
  severity from extracted vitals (arrest indicators), NOT from the confidence
  score — high confidence does not mean high severity, and CPR is gated on
  actual arrest indicators.
- **Text input.** The system provides a text-based context field to supplement the primary sensor flow.
- **Location sharing with live map.** The dashboard requests geolocation and
  embeds a Google Maps view of the caller's coordinates (no API key required —
  `output=embed` form).

---

## 4. Technologies Used

**Backend (from `requirements.txt`, verbatim):**
- python-dotenv >= 1.0.0
- google-genai >= 1.0.0
- pydantic >= 2.0.0
- fastapi >= 0.110.0
- uvicorn >= 0.27.0
- sse-starlette >= 2.0.0

**Frontend runtime dependencies (from `package.json`, verbatim):**
- @radix-ui/react-progress ^1.1.0
- @radix-ui/react-slot ^1.1.0
- class-variance-authority ^0.7.0
- clsx ^2.1.1
- lucide-react ^0.414.0
- next ^14.2.33
- react ^18.3.1
- react-dom ^18.3.1
- tailwind-merge ^2.4.0
- tailwindcss-animate ^1.0.7

**Frontend dev dependencies (from `package.json`, verbatim):**
- @types/node ^20.14.11
- @types/react ^18.3.3
- @types/react-dom ^18.3.0
- autoprefixer ^10.4.19
- postcss ^8.4.39
- tailwindcss ^3.4.6
- typescript ^5.5.3

**AI engine:** Google AI Studio via the unified `google-genai` SDK — `gemini-3.1-flash-lite` (primary), `gemini-3.5-flash` (fallback). Verified in extraction.py lines 40-41.

**Cloud / hosting services wired up in deployment:**
- Google Cloud Run (containerized FastAPI backend — `Dockerfile` present)
- Firebase Hosting (Next.js static export — `firebase.json` present,
  `output: "export"` in `next.config.mjs`)
- Google Maps embed (keyless `output=embed`) on the dashboard

---

## 5. Credits (every library actually present in the dependency files)

**`requirements.txt`:**
- python-dotenv
- google-genai
- pydantic
- fastapi
- uvicorn
- sse-starlette

**`package.json` (dependencies):**
- @radix-ui/react-progress
- @radix-ui/react-slot
- class-variance-authority
- clsx
- lucide-react
- next
- react
- react-dom
- tailwind-merge
- tailwindcss-animate

**`package.json` (devDependencies):**
- @types/node
- @types/react
- @types/react-dom
- autoprefixer
- postcss
- tailwindcss
- typescript

---

## Repository

- GitHub: https://github.com/Mohit25f101/Override.git
- Author: Mohit Kumar

---

## 6. Google Doc Update — "The Last-Minute Life Saver" (Override Moment)

> Paste the block below into the submission Google Doc.

PROBLEM STATEMENT: The Last-Minute Life Saver

SOLUTION OVERVIEW:
Override is an AI-powered deadline crisis companion that moves beyond
passive reminders. Using a Confidence-Validated Loop (CVL) architecture
powered by Google Gemini, Override continuously monitors your active
deadlines and detects the exact moment a crisis becomes inevitable —
then autonomously kicks in with a rescue plan, timed micro-steps, and
a pre-drafted email, all within seconds of detection.

KEY FEATURES:
- CVL Deadline Engine: Multi-signal confidence loop that scores deadline
  breach probability in real-time (not a simple reminder)
- The Override Moment: When urgency score hits 0.75+, the interface
  transforms — full-screen crimson takeover with crisis context and rescue plan
- Gemini Rescue Plan: Breaks any task into concrete timed micro-steps
  that fit the remaining time window
- Autonomous Email Draft: If you'll likely miss the deadline, Gemini
  pre-writes the professional email — one tap to send
- Live Urgency Gauge: SVG confidence meter updates every 60 seconds
  showing breach probability, not just "you have a reminder"
- Focus Timer: Tracks each micro-step with a dedicated countdown

TECHNOLOGIES USED:
- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Python FastAPI (backend CVL engine)
- Firebase Hosting (Google Cloud)
- Google Gemini 2.0 Flash (CVL scoring + rescue plan + email drafting)
- Web APIs: localStorage, crypto.randomUUID, navigator.clipboard, mailto

GOOGLE TECHNOLOGIES UTILIZED:
- Google Gemini 2.0 Flash: Powers the CVL confidence scoring,
  micro-step generation, and automated email drafting
- Firebase Hosting: Production frontend deployment on Google Cloud
- Google AI Studio: Development and API key management

### Implementation notes (what was actually built in Prompt 2)
- New main page `app/tasks/page.tsx` with three auto-transitioning visual
  states: CALM (near-black) → MONITORING (warm amber tint) → THE OVERRIDE
  MOMENT (pulsing crimson full-screen takeover).
- Eight new client components in `app/components/`: TaskInputForm,
  UrgencyGauge (hand-built SVG, no libraries), TaskCard, CountdownTimer,
  MicroStepList, RescuePlanPanel, EmailDraftSection, OverrideMomentOverlay.
- Live urgency loop polls `POST /task-analyze` every 60 seconds; reaching
  urgency_score ≥ 0.75 triggers the Override overlay, which fetches
  `POST /rescue-plan` on mount.
- Tasks persist in `localStorage` under key `override_tasks`
  (id via `crypto.randomUUID()`); a deadline-crisis banner links to
  `/tasks` from both the landing page and the dashboard.
- CSS-only animations (gradient-shift, border-pulse, slide-up,
  countdown-flash) — no new npm packages were added.
