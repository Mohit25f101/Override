# Override backend — FastAPI + SSE, deployed to Cloud Run.
# Entrypoint verified from main.py:  app = FastAPI(...)  ->  module:object = main:app
FROM python:3.11-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the source.
COPY . .

# Cloud Run injects $PORT (defaults to 8080). Bind uvicorn to it.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
