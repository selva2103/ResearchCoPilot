"""
Shared async HTTP client factory.

Provides a single long-lived httpx.AsyncClient with:
  - Timeout sourced from UPSTREAM_TIMEOUT_SECONDS config.
  - Connection pooling and keep-alive enabled.
  - A graceful shutdown helper for use in the FastAPI lifespan.

No external calls happen here — this module purely configures the client.
Future modules (PubMed, GEO, SRA, UniProt, …) import get_http_client()
and use it instead of creating their own clients.

TODO: add per-domain retry policies (tenacity) when modules are added
TODO: add OpenTelemetry instrumentation for outbound requests
TODO: add Prometheus histogram for upstream response times
"""

import httpx

from app.core.config import settings

_client: httpx.AsyncClient | None = None


async def get_http_client() -> httpx.AsyncClient:
    """
    Return the shared async HTTP client, initialising it on first call.

    Configured with:
      - timeout: UPSTREAM_TIMEOUT_SECONDS (connect + read + write + pool)
      - max_keepalive_connections: 20
      - max_connections: 100
    """
    global _client
    if _client is None or _client.is_closed:
        timeout = httpx.Timeout(settings.UPSTREAM_TIMEOUT_SECONDS)
        limits = httpx.Limits(
            max_keepalive_connections=20,
            max_connections=100,
            keepalive_expiry=30,
        )
        _client = httpx.AsyncClient(timeout=timeout, limits=limits)
    return _client


async def close_http_client() -> None:
    """Gracefully close the shared client. Call from the FastAPI lifespan shutdown."""
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
    _client = None
