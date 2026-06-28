# Override: AI Decision Engine for Emergencies

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688)
![Google Gemini](https://img.shields.io/badge/Powered%20by-Google%20Gemini-4285F4)

Override is an AI-powered emergency decision engine. It is **not** a conversational chatbot. It is a structured triage system designed to make safe, validated decisions under uncertainty. 

## 🧠 Why This Was Built (The Problem)
In critical emergencies, blind trust in AI can be dangerous. Standard Large Language Models (LLMs) are prone to hallucinating or confidently guessing when they lack sufficient context. If a user says, *"My dad collapsed,"* a standard AI might immediately output CPR instructions—even if the patient just fainted and is breathing normally. 

**Override solves this by introducing a Constraint Validation Layer (CVL).** Instead of guessing, Override assesses its own confidence based on hard medical evidence (e.g., breathing, pulse, consciousness). If the confidence score is too low, the system halts and asks a single, highly targeted follow-up question to gather the missing facts before recommending an action.

## ⚙️ How It Works (The Architecture)
Override operates on a strict, multi-stage validation loop to ensure accuracy:

1. **Text Input:** The user provides a text description of the emergency to supplement sensor data.
2. **Structured Extraction:** The Gemini model parses the chaotic input and extracts observable facts into a strict JSON schema.
3. **Constraint Validation Layer (CVL):** The system calculates a weighted confidence score. Critical missing fields (like breathing status) heavily penalize the score.
4. **The Validation Loop:** * If confidence is **≥ 85%**: The system proceeds immediately.
   * If confidence is **< 85%**: The system generates a targeted follow-up question (e.g., *"Is he breathing normally?"*). 
   * *Safety Cap:* The loop maxes out at 2 iterations. If uncertainty remains, it forces a safe-fallback decision to prevent endless questioning.
5. **Action Dashboard:** The user is presented with a severity-coded dashboard containing immediate steps (e.g., 112 dialing, CPR steps, location sharing).

## 🛠️ Tech Stack
* **Frontend:** Next.js 14 (App Router), Tailwind CSS, shadcn/ui
* **Backend:** Python, FastAPI, Server-Sent Events (SSE) for real-time pipeline streaming
* **AI Engine:** Google AI Studio — gemini-3.5-flash (primary), gemini-3.1-flash-lite (fallback)

---

## 🚀 Getting Started

Follow these steps to run Override locally on your machine.

### Prerequisites
* Node.js (v18 or higher)
* Python (3.9 or higher)
* A valid Google Gemini API Key

### 1. Clone the Repository
```bash
git clone [https://github.com/Mohit25f101/Override.git](https://github.com/Mohit25f101/Override.git)
cd Override

# Create a virtual environment
python -m venv .venv

# Activate the virtual environment
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

Set up your environment variables:
Create a .env file in your backend directory and add your Gemini API key:

Code snippet
GEMINI_API_KEY=your_api_key_here
⚠️ SECURITY WARNING: Never commit your .env file to GitHub. Ensure .env is listed inside your .gitignore file before pushing any code.

Start the backend server:

Bash
uvicorn main:app --reload --port 8000
The API will now be running on http://localhost:8000.

3. Frontend Setup (Next.js)
Open a second terminal window and navigate to the frontend directory (or root if combined).

Bash
# Install Node dependencies
npm install

# Start the development server
npm run dev
The user interface will now be running at http://localhost:3000.

💻 Usage
Open http://localhost:3000 in your browser.

Click "Run Demo Scenario" or type to describe a mock emergency (e.g., "My friend fell off his bike and isn't moving").

Watch the SSE pipeline visually process the extraction and validation.

Answer any follow-up questions the engine asks.

View the final severity-coded Action Dashboard.

## ☁️ Deployment (Cloud Run + Firebase Hosting)

The backend deploys to **Google Cloud Run** (containerized via the included
`Dockerfile`) and the frontend deploys to **Firebase Hosting** as a Next.js
static export (`output: "export"` in `next.config.mjs`, served from `out/`).

### 1. Deploy the backend to Cloud Run

```bash
# Requires: authenticated gcloud, a GCP project with billing enabled, a real Gemini key.
gcloud run deploy override-backend \
  --source . \
  --platform managed \
  --region <YOUR_REGION> \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=<YOUR_REAL_KEY>
```

Record the **actual** service URL that `gcloud` prints, then verify it:

```bash
curl <ACTUAL_CLOUD_RUN_URL>/        # GET / returns the health JSON
```

### 2. Deploy the frontend to Firebase Hosting

```bash
# Bake the REAL Cloud Run URL into the static build:
NEXT_PUBLIC_API_URL="<YOUR_CLOUD_RUN_URL>" npm run build

npm install -g firebase-tools     # if not already installed
firebase login
firebase use --add                # bind your real Firebase project (creates .firebaserc)
firebase deploy --only hosting    # firebase.json already points public -> out
```

Load the printed Hosting URL in an incognito window and confirm (via the
Network tab) that requests go to the Cloud Run backend, **not** localhost.

> `API_BASE` in `app/page.tsx` and `app/dashboard/page.tsx` reads `NEXT_PUBLIC_API_URL` and falls back
> to `http://localhost:8000` for local dev. Set the env var at build
> time for production.

---

👨‍💻 Author
Built by Mohit Kumar
