"""
Health-check response model.

Returned by GET /research-api/health.

Example response:
    {
        "status": "ok",
        "redis": "connected",
        "uptime_seconds": 142.7
    }
"""

from app.models.base import BaseAPIResponse


class HealthResponse(BaseAPIResponse):
    """Health-check payload."""

    status: str
    """Overall service status. 'ok' when the API process is running."""

    redis: str
    """
    Redis connectivity status.
    Values: 'connected' | 'unavailable'
    The service continues to function when Redis is unavailable —
    caching and rate-limiting are disabled but requests are served.
    """

    uptime_seconds: float
    """Seconds elapsed since the FastAPI application started."""
