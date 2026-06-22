"""
Redis-backed sliding-window rate limiter.

Design goals:
  - Instantiate once per upstream service family (not a singleton).
  - Backed by Redis so limits are shared across multiple uvicorn workers.
  - Async context manager: ``async with ncbi_entrez_limiter: ...``
  - Graceful degradation: when Redis is unavailable, requests are allowed through
    (logging a warning) so the service doesn't hard-fail.

Algorithm: sliding window using a Redis sorted set.
  - Each token is stored as a member with score = timestamp.
  - Members older than (now - per_seconds) are pruned on each check.
  - If current count >= max_requests, wait one token-interval and retry.

Usage:
    async with ncbi_entrez_limiter:
        response = await http_client.get(PUBMED_URL, params=...)

Add named instances for new upstreams as needed:
    uniprot_limiter   = RateLimiter("uniprot",   max_requests=10, per_seconds=1)
    kegg_limiter      = RateLimiter("kegg",       max_requests=3,  per_seconds=1)
    reactome_limiter  = RateLimiter("reactome",   max_requests=5,  per_seconds=1)

TODO: expose per-limiter metrics (wait time, rejection count) via Prometheus
TODO: add dashboard endpoint showing current window utilisation per limiter
TODO: support hard-reject mode (raise 429) instead of soft-wait for strict SLAs
"""

import asyncio
import time
import uuid

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class RateLimiter:
    """
    Sliding-window rate limiter backed by a Redis sorted set.

    Parameters
    ----------
    name:
        Unique name for this limiter — used as the Redis key prefix.
    max_requests:
        Maximum number of requests allowed within *per_seconds*.
    per_seconds:
        Length of the sliding window in seconds.
    redis_url:
        Redis connection string. Defaults to ``settings.REDIS_URL``.
    """

    def __init__(
        self,
        name: str,
        max_requests: int,
        per_seconds: float,
        redis_url: str = settings.REDIS_URL,
    ) -> None:
        self.name = name
        self.max_requests = max_requests
        self.per_seconds = per_seconds
        self._token_interval = per_seconds / max_requests
        self._redis = None
        try:
            import redis.asyncio as aioredis  # noqa: PLC0415
            self._redis = aioredis.from_url(redis_url, decode_responses=True)
        except Exception as exc:
            logger.warning(
                f"rate_limiter init failed, running without limiting: name={name}, error={exc}"
            )

    async def _acquire(self) -> None:
        """Block until a token is available in the current window."""
        if self._redis is None:
            return  # no Redis — allow all requests

        redis_key = f"rate_limiter:{self.name}"
        now = time.time()
        window_start = now - self.per_seconds

        pipe = self._redis.pipeline()
        # 1. Remove tokens outside the current window
        pipe.zremrangebyscore(redis_key, "-inf", window_start)
        # 2. Count remaining tokens in the window
        pipe.zcard(redis_key)
        try:
            results = await pipe.execute()
        except Exception as exc:
            logger.warning(f"rate_limiter Redis error: name={self.name}, error={exc}")
            return

        current_count: int = results[1]

        if current_count >= self.max_requests:
            wait_time = self._token_interval
            logger.info(
                f"rate_limit wait: name={self.name}, "
                f"count={current_count}/{self.max_requests}, "
                f"wait={wait_time:.3f}s"
            )
            await asyncio.sleep(wait_time)
            await self._acquire()  # retry after waiting
            return

        # 3. Record this request as a token in the window
        member = f"{now}:{uuid.uuid4().hex[:8]}"
        try:
            await self._redis.zadd(redis_key, {member: now})
            await self._redis.expire(redis_key, int(self.per_seconds) + 1)
        except Exception as exc:
            logger.warning(f"rate_limiter token add error: name={self.name}, error={exc}")

    async def __aenter__(self) -> "RateLimiter":
        await self._acquire()
        return self

    async def __aexit__(self, exc_type: object, exc_val: object, exc_tb: object) -> bool:
        return False  # do not suppress exceptions


# ---------------------------------------------------------------------------
# Pre-configured limiters
# ---------------------------------------------------------------------------

# All NCBI Entrez endpoints (PubMed, GEO, SRA, GenBank, …) share one pool.
# Ceiling is 3 req/s without an API key, 10 req/s with one.
_ncbi_max = 10 if settings.NCBI_API_KEY else 3
ncbi_entrez_limiter = RateLimiter(
    name="ncbi_entrez",
    max_requests=_ncbi_max,
    per_seconds=1.0,
)
