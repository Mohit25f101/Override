# Override — The Last-Minute Life Saver

## Live Demo
[override-b8a9c.web.app](https://override-b8a9c.web.app)

## What it does
Override is an AI-powered deadline crisis companion that moves beyond passive reminders. Using a Confidence-Validated Loop (CVL) architecture powered by Google Gemini, Override continuously monitors your active deadlines and detects the exact moment a crisis becomes inevitable — then autonomously kicks in with a rescue plan, timed micro-steps, and a pre-drafted email, all within seconds of detection.

## Setup & Run Locally

### Frontend
```bash
git clone https://github.com/Mohit25f101/Override.git
cd Override
npm install
# Point to your deployed backend or use localhost
echo 'NEXT_PUBLIC_API_URL=http://localhost:8000' > .env.local
npm run dev
```

### Backend
```bash
# In project root
pip install -r requirements.txt
# Run the FastAPI server locally
GEMINI_API_KEY="your_gemini_key" uvicorn main:app --reload --port 8000
```

## Tech Stack
- Next.js 14, TypeScript, Tailwind CSS
- Python FastAPI (backend CVL engine)
- Google Gemini 3.1 Flash Lite (CVL scoring + rescue plan + email drafting)
- Firebase Hosting (Frontend Deployment)
- Google Cloud Run (Backend Deployment)

## Key Features
- **CVL Deadline Engine:** Multi-signal confidence loop that scores deadline breach probability in real-time.
- **The Override Moment:** When urgency score hits 0.75+, the interface transforms into a full-screen takeover with crisis context and a rescue plan.
- **Gemini Rescue Plan:** Breaks any task into concrete timed micro-steps that fit the remaining time window.
- **Autonomous Email Draft:** If you'll likely miss the deadline, Gemini pre-writes a professional email for you to send with one tap.
- **Live Urgency Gauge:** SVG confidence meter updates every 60 seconds showing breach probability.
- **Focus Timer:** A global countdown timer tracking the exact time left until the deadline.

## Hackathon Submission Details
- **Problem Statement:** The Last-Minute Life Saver
- **Deployment:** Google Cloud (Firebase Hosting & Cloud Run)
- **AI Integration:** Google Gemini API (via AI Studio)
