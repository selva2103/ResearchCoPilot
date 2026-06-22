"""
Tests for ResponseAssembler.

At this stage the assembler is a skeleton — methods must exist,
be callable, and return the expected structural shape without raising.
"""

import pytest

from app.services.response_assembler import ResponseAssembler, assembler


# ── Singleton ────────────────────────────────────────────────────────────────

def test_assembler_singleton_is_response_assembler():
    assert isinstance(assembler, ResponseAssembler)


# ── merge ────────────────────────────────────────────────────────────────────

def test_merge_is_callable():
    assert callable(assembler.merge)


def test_merge_returns_dict():
    result = assembler.merge({"pubmed": [1, 2], "geo": [3]})
    assert isinstance(result, dict)


def test_merge_empty_input():
    result = assembler.merge({})
    assert result == {} or isinstance(result, dict)


def test_merge_does_not_raise_with_various_types():
    assembler.merge({"a": None, "b": [], "c": {"nested": True}})


# ── merge_partial ────────────────────────────────────────────────────────────

def test_merge_partial_is_callable():
    assert callable(assembler.merge_partial)


def test_merge_partial_returns_dict():
    result = assembler.merge_partial(
        results={"pubmed": [1, 2]},
        errors={"geo": "timeout"},
    )
    assert isinstance(result, dict)


def test_merge_partial_partial_flag_true_when_errors():
    result = assembler.merge_partial(
        results={"pubmed": [1]},
        errors={"geo": "failed"},
    )
    assert result.get("partial") is True


def test_merge_partial_partial_flag_false_or_absent_when_no_errors():
    result = assembler.merge_partial(results={"pubmed": [1]}, errors=None)
    assert not result.get("partial")


def test_merge_partial_no_errors_arg():
    """errors defaults to None — must not raise."""
    result = assembler.merge_partial(results={"pubmed": [1]})
    assert isinstance(result, dict)


# ── format_response ──────────────────────────────────────────────────────────

def test_format_response_is_callable():
    assert callable(assembler.format_response)


def test_format_response_returns_dict():
    result = assembler.format_response({"pubmed": [1, 2]})
    assert isinstance(result, dict)


def test_format_response_does_not_raise_with_empty_input():
    assembler.format_response({})


def test_format_response_does_not_raise_with_nested_data():
    assembler.format_response(
        {"results": {"pubmed": [1, 2]}, "errors": {}, "partial": False}
    )


# ── Method chaining (pipeline contract) ──────────────────────────────────────

def test_full_pipeline_does_not_raise():
    """merge → merge_partial → format_response pipeline works end-to-end."""
    raw = {"pubmed": ["PMID1"], "geo": ["GSE1"]}
    merged = assembler.merge(raw)
    partial = assembler.merge_partial(results=merged, errors={"sra": "not implemented"})
    formatted = assembler.format_response(partial)
    assert isinstance(formatted, dict)
