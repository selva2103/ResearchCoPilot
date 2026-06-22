#!/bin/bash
set -e
cd /home/runner/workspace/artifacts/research-api
python3 -m pip install -r requirements.txt -q
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --reload
