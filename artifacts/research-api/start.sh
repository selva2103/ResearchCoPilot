#!/bin/bash
set -e
cd /home/runner/workspace/artifacts/research-api

# Skip pip install if all required packages are already importable (avoids startup timeout).
python3 -c "import fastapi, uvicorn, redis, pydantic_settings, httpx" 2>/dev/null \
  || python3 -m pip install -r requirements.txt -q --break-system-packages

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --reload
