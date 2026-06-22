"""
Tests for HTTP endpoints.

Covers:
  - GET /research-api/health — shape, status codes, field types
  - Global exception handler — unhandled errors return ErrorResponse shape
  - Error responses always include request_id
"""

import pytest
from unittest.mock import AsyncMock, patch


# ── /health ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health_returns_200(app_client):
    with patch("app.core.cache.cache.ping", new=AsyncMock(return_value=False)):
        response = await app_client.get("/research-api/health")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_health_response_shape(app_client):
    """HealthResponse has status, redis, and uptime_seconds."""
    with patch("app.core.cache.cache.ping", new=AsyncMock(return_value=False)):
        response = await app_client.get("/research-api/health")
    body = response.json()
    assert "status" in body
    assert "redis" in body
    assert "uptime_seconds" in body


@pytest.mark.asyncio
async def test_health_status_is_ok(app_client):
    with patch("app.core.cache.cache.ping", new=AsyncMock(return_value=False)):
        response = await app_client.get("/research-api/health")
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_health_redis_connected_when_ping_ok(app_client):
    with patch("app.core.cache.cache.ping", new=AsyncMock(return_value=True)):
        response = await app_client.get("/research-api/health")
    assert response.json()["redis"] == "connected"


@pytest.mark.asyncio
async def test_health_redis_unavailable_when_ping_fails(app_client):
    with patch("app.core.cache.cache.ping", new=AsyncMock(return_value=False)):
        response = await app_client.get("/research-api/health")
    assert response.json()["redis"] == "unavailable"


@pytest.mark.asyncio
async def test_health_uptime_is_positive_float(app_client):
    with patch("app.core.cache.cache.ping", new=AsyncMock(return_value=False)):
        response = await app_client.get("/research-api/health")
    uptime = response.json()["uptime_seconds"]
    assert isinstance(uptime, float)
    assert uptime >= 0.0


# ── Global exception handler ──────────────────────────────────────────────────
#
# We test the exception handler *function* directly rather than routing a
# crash through the full ASGI stack.  FastAPI 0.115 / Starlette 0.40 registers
# `@app.exception_handler(Exception)` as the ServerErrorMiddleware error_handler;
# how that middleware dispatches to the handler is FastAPI-internal behaviour.
# What we own — and must verify — is the handler's return value shape and its
# use of the request-scoped correlation ID.

@pytest.mark.asyncio
async def test_unhandled_error_returns_error_response_shape():
    """
    The global exception handler returns a valid ErrorResponse body.
    Tests the handler function directly (not through the ASGI stack).
    """
    import json
    from starlette.requests import Request
    from app.main import _global_exception_handler

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/research-api/test",
        "query_string": b"",
        "headers": [],
    }
    request = Request(scope)
    exc = RuntimeError("intentional crash for testing")

    response = await _global_exception_handler(request, exc)
    assert response.status_code == 500

    body = json.loads(response.body)
    assert "error" in body
    error = body["error"]
    assert "code" in error
    assert "message" in error
    assert "module" in error
    assert "request_id" in error


@pytest.mark.asyncio
async def test_error_response_includes_request_id():
    """Error responses carry the correlation ID from the current ContextVar."""
    import json
    from starlette.requests import Request
    from app.main import _global_exception_handler
    from app.core.request_context import _request_id_var

    custom_id = "test-correlation-id-xyz"
    token = _request_id_var.set(custom_id)
    try:
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/research-api/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)
        exc = ValueError("crash")

        response = await _global_exception_handler(request, exc)
        body = json.loads(response.body)
        assert body["error"]["request_id"] == custom_id
    finally:
        _request_id_var.reset(token)
