"""
Tests for RateLimiter.

Verifies:
  - Requests within the limit pass through immediately.
  - Requests beyond the limit trigger asyncio.sleep (delay behaviour).
  - Redis errors are tolerated (requests are allowed through).
  - Async context manager protocol works.
"""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.rate_limiter import RateLimiter


def _make_limiter(mock_redis, max_requests=3, per_seconds=1.0) -> RateLimiter:
    """Build a RateLimiter wired to a mocked Redis client."""
    limiter = RateLimiter.__new__(RateLimiter)
    limiter.name = "test_limiter"
    limiter.max_requests = max_requests
    limiter.per_seconds = per_seconds
    limiter._token_interval = per_seconds / max_requests
    limiter._redis = mock_redis
    return limiter


@pytest.mark.asyncio
async def test_allows_requests_within_limit(mock_redis):
    """When count < max_requests, _acquire returns without sleeping."""
    mock_redis.pipeline.return_value.execute = AsyncMock(
        return_value=[0, 2]  # 2 tokens in window (< max 3)
    )

    limiter = _make_limiter(mock_redis, max_requests=3)

    with patch("asyncio.sleep") as mock_sleep:
        await limiter._acquire()
        mock_sleep.assert_not_called()


@pytest.mark.asyncio
async def test_delays_when_at_capacity(mock_redis):
    """When count >= max_requests, _acquire calls asyncio.sleep once then allows."""
    call_count = 0

    async def execute_side_effect():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return [0, 3]   # first call: at capacity
        return [0, 0]       # second call (after sleep): under limit

    mock_redis.pipeline.return_value.execute = execute_side_effect

    limiter = _make_limiter(mock_redis, max_requests=3, per_seconds=1.0)

    sleep_calls = []
    original_sleep = asyncio.sleep

    async def fake_sleep(t):
        sleep_calls.append(t)

    with patch("asyncio.sleep", side_effect=fake_sleep):
        await limiter._acquire()

    assert len(sleep_calls) == 1
    assert sleep_calls[0] == pytest.approx(1.0 / 3, rel=0.01)


@pytest.mark.asyncio
async def test_allows_through_when_redis_unavailable():
    """When _redis is None, _acquire is a no-op (no error, no sleep)."""
    limiter = RateLimiter.__new__(RateLimiter)
    limiter.name = "no_redis"
    limiter.max_requests = 3
    limiter.per_seconds = 1.0
    limiter._token_interval = 1.0 / 3
    limiter._redis = None

    with patch("asyncio.sleep") as mock_sleep:
        await limiter._acquire()
        mock_sleep.assert_not_called()


@pytest.mark.asyncio
async def test_redis_error_is_tolerated(mock_redis):
    """Redis pipeline errors are logged and the request is allowed through."""
    mock_redis.pipeline.return_value.execute = AsyncMock(
        side_effect=ConnectionError("Redis down")
    )

    limiter = _make_limiter(mock_redis)

    with patch("asyncio.sleep") as mock_sleep:
        await limiter._acquire()    # must not raise
        mock_sleep.assert_not_called()


@pytest.mark.asyncio
async def test_context_manager_protocol(mock_redis):
    """Verify the async context manager enters and exits without error."""
    mock_redis.pipeline.return_value.execute = AsyncMock(return_value=[0, 0])

    limiter = _make_limiter(mock_redis)

    entered = False
    async with limiter:
        entered = True

    assert entered


@pytest.mark.asyncio
async def test_context_manager_does_not_suppress_exceptions(mock_redis):
    """Exceptions raised inside the context manager should propagate."""
    mock_redis.pipeline.return_value.execute = AsyncMock(return_value=[0, 0])
    limiter = _make_limiter(mock_redis)

    with pytest.raises(ValueError, match="test error"):
        async with limiter:
            raise ValueError("test error")
