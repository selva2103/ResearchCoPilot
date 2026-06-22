"""
Tests for RequestIDMiddleware (correlation ID behaviour).

Scenarios:
  - ID is generated when X-Request-ID header is absent.
  - ID is preserved (re-used) when X-Request-ID header is supplied.
  - ID is present in response headers in both cases.
  - Generated IDs are valid UUID4 strings.
"""

import re
import uuid

import pytest

UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


@pytest.mark.asyncio
async def test_request_id_generated_when_absent(app_client):
    """A UUID4 X-Request-ID is injected when none is supplied."""
    response = await app_client.get("/research-api/health")
    request_id = response.headers.get("x-request-id")
    assert request_id is not None
    assert UUID4_RE.match(request_id), f"Not a valid UUID4: {request_id}"


@pytest.mark.asyncio
async def test_request_id_preserved_when_supplied(app_client):
    """An incoming X-Request-ID is echoed back unchanged in the response."""
    custom_id = "my-custom-trace-id-12345"
    response = await app_client.get(
        "/research-api/health",
        headers={"X-Request-ID": custom_id},
    )
    assert response.headers.get("x-request-id") == custom_id


@pytest.mark.asyncio
async def test_request_id_in_response_headers(app_client):
    """Every response carries an X-Request-ID header."""
    response = await app_client.get("/research-api/health")
    assert "x-request-id" in response.headers


@pytest.mark.asyncio
async def test_each_request_gets_unique_id(app_client):
    """Two requests without supplied IDs get different UUIDs."""
    r1 = await app_client.get("/research-api/health")
    r2 = await app_client.get("/research-api/health")
    id1 = r1.headers.get("x-request-id")
    id2 = r2.headers.get("x-request-id")
    assert id1 != id2


@pytest.mark.asyncio
async def test_supplied_id_any_string_is_echoed(app_client):
    """Non-UUID custom IDs are echoed as-is."""
    custom = "service-a::req-0042"
    response = await app_client.get(
        "/research-api/health",
        headers={"X-Request-ID": custom},
    )
    assert response.headers.get("x-request-id") == custom
