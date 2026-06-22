"""
Redis-backed cache layer.

Keys are built from a module name + normalized query hash so that:
  - "TP53" and " tp53 " produce the same cache key
  - Each module has its own key namespace

Empty and error results are never cached — only successful, non-empty values.

Usage:
    from app.core.cache import cache, make_cache_key
    key = make_cache_key("pubmed", query)
    result = await cache.get(key)
    if result is None:
        result = await fetch_from_pubmed(query)
        await cache.set(key, result)

TODO: add cache invalidation API (admin endpoint)
TODO: add Prometheus counter for cache hit/miss rate per module
TODO: add per-module TTL overrides (e.g. GEO datasets cached longer than PubMed)
"""

import hashlib
import json

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def normalize_query(query: str) -> str:
    """
    Normalise a query string for consistent cache key generation.

    Rules:
      - Strip leading/trailing whitespace
      - Lowercase everything
      - Sort terms alphabetically so "TP53 cancer" == "cancer TP53"
    """
    terms = query.lower().strip().split()
    return " ".join(sorted(terms))


def make_cache_key(module_name: str, query: str) -> str:
    """
    Build a cache key from a module name and normalised query.

    Format: ``{module_name}:{first_16_chars_of_sha256_of_normalised_query}``

    Example: ``pubmed:3f1e9a4c2b7d8e01``
    """
    normalized = normalize_query(query)
    query_hash = hashlib.sha256(normalized.encode()).hexdigest()[:16]
    return f"{module_name}:{query_hash}"


class CacheClient:
    """
    Async Redis cache client with graceful degradation.

    When Redis is unavailable (no REDIS_URL, connection refused, etc.)
    all operations are no-ops and the service continues without caching.
    """

    def __init__(self, redis_url: str = settings.REDIS_URL) -> None:
        self._redis = None
        try:
            import redis.asyncio as aioredis  # noqa: PLC0415
            self._redis = aioredis.from_url(redis_url, decode_responses=True)
        except Exception as exc:
            logger.warning(f"cache init failed, running without cache: {exc}")

    async def get(self, key: str) -> object | None:
        """Return the cached value for *key*, or None on miss/error."""
        if self._redis is None:
            return None
        try:
            raw = await self._redis.get(key)
            if raw is not None:
                logger.info(f"cache hit: {key}")
                return json.loads(raw)
            logger.info(f"cache miss: {key}")
            return None
        except Exception as exc:
            logger.warning(f"cache get error: key={key}, error={exc}")
            return None

    async def set(
        self,
        key: str,
        value: object,
        ttl_seconds: int = settings.CACHE_TTL_SECONDS,
    ) -> None:
        """Store *value* under *key* with the given TTL. Skips empty values."""
        if self._redis is None or not value:
            return
        try:
            await self._redis.setex(key, ttl_seconds, json.dumps(value))
            logger.info(f"cache set: key={key}, ttl={ttl_seconds}s")
        except Exception as exc:
            logger.warning(f"cache set error: key={key}, error={exc}")

    async def delete(self, key: str) -> None:
        """Delete a cache entry. No-op if the key does not exist."""
        if self._redis is None:
            return
        try:
            await self._redis.delete(key)
            logger.info(f"cache delete: key={key}")
        except Exception as exc:
            logger.warning(f"cache delete error: key={key}, error={exc}")

    async def ping(self) -> bool:
        """Return True if Redis responds to PING."""
        if self._redis is None:
            return False
        try:
            return bool(await self._redis.ping())
        except Exception:
            return False


# Module-level singleton — import this everywhere
cache = CacheClient()
