"""
Tests for ModuleRegistry, fan_out, and not_implemented_error.

Key scenarios:
  - Requesting an unregistered module returns a structured ErrorResponse, not a crash.
  - fan_out returns partial results when one of two concurrent calls raises.
  - fan_out respects per-call timeout.
  - Registry register/get/list_modules work correctly.
"""

import asyncio
import pytest

from app.services.module_router import (
    ModuleRegistry,
    fan_out,
    not_implemented_error,
)


# ── Registry ────────────────────────────────────────────────────────────────

def test_registry_register_and_get():
    reg = ModuleRegistry()

    async def dummy(q: str):
        return {"result": q}

    reg.register("test_module", dummy)
    assert reg.get("test_module") is dummy


def test_registry_get_unknown_returns_none():
    reg = ModuleRegistry()
    assert reg.get("nonexistent") is None


def test_registry_list_modules():
    reg = ModuleRegistry()
    reg.register("a", lambda q: None)
    reg.register("b", lambda q: None)
    assert set(reg.list_modules()) == {"a", "b"}


# ── not_implemented_error ────────────────────────────────────────────────────

def test_not_implemented_error_structure():
    resp = not_implemented_error("pubmed")
    assert resp.error.code == "NOT_IMPLEMENTED"
    assert "pubmed" in resp.error.message
    assert resp.error.module == "pubmed"
    assert isinstance(resp.error.request_id, str)


def test_not_implemented_error_does_not_raise():
    """Calling for any module name never raises an exception."""
    for name in ["geo", "sra", "uniprot", "unknown_module_xyz"]:
        resp = not_implemented_error(name)
        assert resp.error.code == "NOT_IMPLEMENTED"


# ── fan_out ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fan_out_partial_results_one_success_one_raise():
    """
    fan_out with two modules — one succeeds, one raises.
    Both results are returned; the failing one is an error dict.
    The batch never raises.
    """

    async def good_module(query: str):
        return {"papers": ["PMID1", "PMID2"]}

    async def bad_module(query: str):
        raise RuntimeError("upstream failure")

    results = await fan_out(
        query="CRISPR",
        module_names=["good", "bad"],
        timeout=5.0,
    )

    # Manually inject handlers into a fresh registry for this test
    # (fan_out uses the global registry by default)
    from app.services import module_router as mr
    original_handlers = dict(mr.registry._handlers)
    mr.registry.register("good", good_module)
    mr.registry.register("bad", bad_module)
    try:
        results = await fan_out(query="CRISPR", module_names=["good", "bad"], timeout=5.0)
    finally:
        mr.registry._handlers = original_handlers

    assert "good" in results
    assert results["good"] == {"papers": ["PMID1", "PMID2"]}
    assert "bad" in results
    assert "error" in results["bad"]


@pytest.mark.asyncio
async def test_fan_out_unregistered_module_returns_error_dict():
    """Calling fan_out with an unregistered name never raises — returns error dict."""
    results = await fan_out(
        query="cancer",
        module_names=["definitely_not_registered_xyz"],
        timeout=5.0,
    )
    assert "definitely_not_registered_xyz" in results
    assert "error" in results["definitely_not_registered_xyz"]


@pytest.mark.asyncio
async def test_fan_out_timeout_is_respected():
    """A module that takes longer than timeout produces a timeout error dict."""

    async def slow_module(query: str):
        await asyncio.sleep(10)  # much longer than our timeout
        return {"data": "never"}

    from app.services import module_router as mr
    original_handlers = dict(mr.registry._handlers)
    mr.registry.register("slow", slow_module)
    try:
        results = await fan_out(query="anything", module_names=["slow"], timeout=0.05)
    finally:
        mr.registry._handlers = original_handlers

    assert "slow" in results
    assert results["slow"].get("error") == "timeout"


@pytest.mark.asyncio
async def test_fan_out_empty_module_list():
    """Empty module list returns an empty dict."""
    results = await fan_out(query="cancer", module_names=[], timeout=5.0)
    assert results == {}


@pytest.mark.asyncio
async def test_fan_out_all_succeed():
    """All modules succeed → all results present and correct."""

    async def module_a(q: str):
        return {"source": "a", "query": q}

    async def module_b(q: str):
        return {"source": "b", "query": q}

    from app.services import module_router as mr
    original_handlers = dict(mr.registry._handlers)
    mr.registry.register("m_a", module_a)
    mr.registry.register("m_b", module_b)
    try:
        results = await fan_out(query="RNA", module_names=["m_a", "m_b"], timeout=5.0)
    finally:
        mr.registry._handlers = original_handlers

    assert results["m_a"]["source"] == "a"
    assert results["m_b"]["source"] == "b"
