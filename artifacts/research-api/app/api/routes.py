"""
FastAPI route handlers for the Research API.

All paths include the /research-api prefix because the global proxy routes
/research-api → this service without rewriting the path.

Current endpoints:
    GET /research-api/health   — liveness + Redis + uptime

TODO: POST /research-api/analyze  — fan-out to registered modules
TODO: GET  /research-api/modules  — list registered modules + status
TODO: GET  /research-api/metrics  — Prometheus-compatible metrics scrape
"""

import time

from fastapi import APIRouter, Request

from app.core.cache import cache
from app.core.logging import get_logger
from app.models.health import HealthResponse

logger = get_logger(__name__)

router = APIRouter(prefix="/research-api")


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    """
    Liveness and dependency health check.

    Returns:
        status:         'ok' if the API process is running
        redis:          'connected' or 'unavailable'
        uptime_seconds: seconds since app start (stored in app.state.start_time)
    """
    redis_ok = await cache.ping()
    redis_status = "connected" if redis_ok else "unavailable"

    start_time: float = getattr(request.app.state, "start_time", time.time())
    uptime = time.time() - start_time

    logger.info(f"health check: redis={redis_status}, uptime={uptime:.1f}s")

    return HealthResponse(
        status="ok",
        redis=redis_status,
        uptime_seconds=round(uptime, 3),
    )
