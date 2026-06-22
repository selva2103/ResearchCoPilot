"""
Tests for CacheClient: get / set / delete and normalize_query / make_cache_key helpers.

Redis is mocked — no real Redis instance required.
"""

import json
import pytest
from unittest.mock import AsyncMock, patch

from app.core.cache import CacheClient, make_cache_key, normalize_query


# ── normalize_query ──────────────────────────────────────────────────────────

def test_normalize_strips_whitespace():
    assert normalize_query("  TP53  ") == "tp53"


def test_normalize_lowercases():
    assert normalize_query("CRISPR") == "crispr"


def test_normalize_sorts_terms():
    assert normalize_query("cancer RNA") == "cancer rna"


def test_normalize_is_stable():
    assert normalize_query("gut microbiome obesity") == normalize_query("obesity gut microbiome")


# ── make_cache_key ───────────────────────────────────────────────────────────

def test_make_cache_key_format():
    key = make_cache_key("pubmed", "cancer")
    assert key.startswith("pubmed:")
    assert len(key) == len("pubmed:") + 16  # 16-char hex digest


def test_make_cache_key_stable_across_calls():
    assert make_cache_key("geo", "RNA cancer") == make_cache_key("geo", "RNA cancer")


def test_make_cache_key_query_normalization():
    # Same terms, different order → same key
    assert make_cache_key("sra", "cancer RNA") == make_cache_key("sra", "RNA cancer")


def test_make_cache_key_different_modules_differ():
    assert make_cache_key("pubmed", "cancer") != make_cache_key("geo", "cancer")


# ── CacheClient.get ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cache_get_hit(mock_redis):
    payload = {"papers": ["PMID1", "PMID2"]}
    mock_redis.get.return_value = json.dumps(payload)

    client = CacheClient.__new__(CacheClient)
    client._redis = mock_redis

    result = await client.get("pubmed:abc")
    assert result == payload
    mock_redis.get.assert_called_once_with("pubmed:abc")


@pytest.mark.asyncio
async def test_cache_get_miss(mock_redis):
    mock_redis.get.return_value = None

    client = CacheClient.__new__(CacheClient)
    client._redis = mock_redis

    result = await client.get("pubmed:abc")
    assert result is None


@pytest.mark.asyncio
async def test_cache_get_redis_none():
    """When Redis is unavailable, get() returns None without raising."""
    client = CacheClient.__new__(CacheClient)
    client._redis = None
    result = await client.get("any:key")
    assert result is None


@pytest.mark.asyncio
async def test_cache_get_redis_error(mock_redis):
    """Redis errors are swallowed and None is returned."""
    mock_redis.get.side_effect = ConnectionError("Redis down")

    client = CacheClient.__new__(CacheClient)
    client._redis = mock_redis

    result = await client.get("pubmed:abc")
    assert result is None


# ── CacheClient.set ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cache_set_stores_value(mock_redis):
    client = CacheClient.__new__(CacheClient)
    client._redis = mock_redis

    await client.set("pubmed:abc", {"data": 1}, ttl_seconds=3600)
    mock_redis.setex.assert_called_once()
    call_args = mock_redis.setex.call_args
    assert call_args[0][0] == "pubmed:abc"
    assert call_args[0][1] == 3600


@pytest.mark.asyncio
async def test_cache_set_skips_empty_value(mock_redis):
    client = CacheClient.__new__(CacheClient)
    client._redis = mock_redis

    await client.set("pubmed:abc", [])   # empty list — should not cache
    mock_redis.setex.assert_not_called()

    await client.set("pubmed:abc", {})   # empty dict — should not cache
    mock_redis.setex.assert_not_called()


@pytest.mark.asyncio
async def test_cache_set_redis_none():
    """When Redis is unavailable, set() is a safe no-op."""
    client = CacheClient.__new__(CacheClient)
    client._redis = None
    await client.set("pubmed:abc", {"data": 1})  # must not raise


# ── CacheClient.delete ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cache_delete(mock_redis):
    client = CacheClient.__new__(CacheClient)
    client._redis = mock_redis

    await client.delete("pubmed:abc")
    mock_redis.delete.assert_called_once_with("pubmed:abc")


@pytest.mark.asyncio
async def test_cache_delete_redis_none():
    client = CacheClient.__new__(CacheClient)
    client._redis = None
    await client.delete("pubmed:abc")  # must not raise
