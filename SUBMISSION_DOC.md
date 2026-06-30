# Override — Hackathon Submission

> Paste this content into a Google Doc, then set sharing to
> **"Anyone with the link → Viewer"** and confirm it opens in an incognito window.

---

## 1. Problem Statement Selected

**"The Last-Minute Life Saver"**

---

## 2. Solution Overview

Override is an AI-powered deadline-crisis companion that goes beyond passive
reminders. A Confidence-Validated Loop (CVL), powered by Google Gemini,
continuously re-scores how likely each active task is to miss its deadline
using real-time time-math plus iterative Gemini reasoning. The moment that
risk crosses a critical threshold, Override stops reminding and starts
acting — generating a step-by-step rescue plan and, if the deadline is
realistically unreachable, a ready-to-send extension email.

---

## 3. Key Features

*(Confirmed against the actual code — main.py, cvl.py, extraction.py,
app/tasks/page.tsx.)*

- **CVL Deadline Engine:** Iterative, Gemini-refined urgency scoring re-evaluated
  every 60 seconds, with a deterministic time-math fallback so a flaky API
  call never produces a false "all clear."
- **The Override Moment:** At urgency ≥ 0.75, the UI becomes a full-screen
  crisis takeover.
- **Gemini Rescue Plan:** Up to 6 concrete, timed micro-steps sized to the exact
  time remaining, each one a tappable checklist item you mark off as you go.
- **Autonomous Email Draft:** A tone-matched extension email (professor/manager/
  client/team presets), ready to copy or open in one tap.
- **Live Urgency Gauge:** An SVG confidence meter visualizing breach probability.

---

## 4. Technologies Used

Next.js 14, TypeScript, Tailwind CSS, Python, FastAPI, Pydantic

---

## 5. Google Technologies Utilized

Google Gemini API (via Google AI Studio) for urgency scoring, rescue-plan
generation, and email drafting; Firebase Hosting for the frontend; Google
Cloud Run for the containerized FastAPI backend.

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
