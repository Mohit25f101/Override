# Override — AI-Powered Emergency Decision Engine

## Live Demo
[evocative-lodge-500912-h8.web.app](https://evocative-lodge-500912-h8.web.app)

## What it does
Override is a cutting-edge emergency decision engine that fuses rule-based risk assessment with Google Gemini's advanced reasoning (CVL architecture) to instantly analyze vitals and context, automatically escalating critical emergencies without requiring a human response.

## Setup & Run Locally

### Frontend
```bash
git clone https://github.com/Mohit25f101/Override.git
cd Override
npm install
echo 'NEXT_PUBLIC_API_URL=http://localhost:8000' > .env.local
npm run dev
```

### Backend
```bash
# In project root
pip install -r requirements.txt
GEMINI_API_KEY="your_gemini_key" uvicorn main:app --reload --port 8000
```

## Tech Stack
- Next.js 14, TypeScript, Tailwind CSS
- Python FastAPI (backend)
- Google Gemini (CVL architecture)
- Firebase Hosting + Google Cloud Run
- Google Maps (emergency nearby search)

## Architecture
Override employs a Continuous Verification Loop (CVL) architecture:
1. **Sensors & Context:** Instantly gathers local data (heart rate, fall detection, etc.) and evaluates against a deterministic Risk Engine.
2. **AI Enrichment:** If context is missing or ambiguous, Gemini 3.1 Pro evaluates the situation continuously.
3. **Emergency Escalation:** When confidence crosses a threshold or the risk score becomes critical, the system automatically surfaces the "Last Minute Life Saver" panel to call for help and broadcast location.
