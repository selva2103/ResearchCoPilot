"""
Shared pytest fixtures for the Research API test suite.

Provides:
    app_client — async HTTPX client wired to the FastAPI ASGI app
    mock_redis — mock that satisfies the redis.asyncio interface
"""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, MagicMock


@pytest_asyncio.fixture
async def app_client():
    """
    Async HTTPX client backed by the FastAPI ASGI app (no real server).

    CacheClient and RateLimiter degrade gracefully when Redis is unavailable
    (self._redis stays None), so no patching of __init__ is required.
    Individual tests that need specific Redis behaviour patch at the method level.
    """
    from app.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        yield client


@pytest.fixture
def mock_redis():
    """
    A pre-configured mock that looks like a redis.asyncio.Redis client.

    Important:
        - pipeline() is a SYNCHRONOUS method in redis.asyncio (returns a Pipeline
          object immediately; only execute() is awaited).  It must be a MagicMock,
          not an AsyncMock, or the pipeline object will be a coroutine instead.
        - pipeline command methods (zremrangebyscore, zcard) are sync; only
          execute() is async.
    """
    r = AsyncMock()

    # Scalar async methods
    r.get.return_value = None
    r.setex.return_value = True
    r.delete.return_value = 1
    r.ping.return_value = True
    r.zadd.return_value = 1
    r.expire.return_value = True
    r.zremrangebyscore.return_value = 0
    r.zcard.return_value = 0

    # pipeline() is SYNCHRONOUS — must be MagicMock so the caller gets the
    # pipeline object back immediately (not a coroutine).
    pipeline_mock = MagicMock()
    pipeline_mock.zremrangebyscore.return_value = pipeline_mock  # chainable
    pipeline_mock.zcard.return_value = pipeline_mock             # chainable
    pipeline_mock.execute = AsyncMock(return_value=[0, 0])       # execute IS async
    r.pipeline = MagicMock(return_value=pipeline_mock)

    return r
