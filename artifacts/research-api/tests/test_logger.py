"""
Tests for the structured JSON logger.

Verifies that get_logger() returns a logger whose output includes
the required fields: timestamp, level, request_id, module, message.
"""

import json
import logging
import io
import pytest

from app.core.logging import get_logger, _JsonFormatter


def _capture_log(logger: logging.Logger, level: int, message: str) -> dict:
    """
    Emit one log record and return the parsed JSON fields from it.
    """
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_JsonFormatter())

    # Temporarily add our capturing handler
    logger.addHandler(handler)
    logger.log(level, message)
    logger.removeHandler(handler)

    raw = stream.getvalue().strip()
    return json.loads(raw)


def test_get_logger_returns_logger():
    logger = get_logger("test.module")
    assert isinstance(logger, logging.Logger)


def test_get_logger_is_idempotent():
    """Calling get_logger twice with the same name returns the same instance."""
    l1 = get_logger("test.idem")
    l2 = get_logger("test.idem")
    assert l1 is l2


def test_logger_has_no_duplicate_handlers():
    """get_logger must not add extra handlers on repeated calls."""
    name = "test.no_dup_handlers"
    logger = get_logger(name)
    initial_count = len(logger.handlers)
    get_logger(name)
    get_logger(name)
    assert len(logger.handlers) == initial_count


def test_json_formatter_includes_timestamp():
    logger = get_logger("test.ts")
    fields = _capture_log(logger, logging.INFO, "hello")
    assert "timestamp" in fields
    assert fields["timestamp"]  # non-empty string


def test_json_formatter_includes_level():
    logger = get_logger("test.level")
    fields = _capture_log(logger, logging.WARNING, "warn msg")
    assert fields["level"] == "WARNING"


def test_json_formatter_includes_message():
    logger = get_logger("test.msg")
    fields = _capture_log(logger, logging.INFO, "my log message")
    assert fields["message"] == "my log message"


def test_json_formatter_includes_module():
    logger = get_logger("app.core.some_module")
    fields = _capture_log(logger, logging.INFO, "msg")
    assert fields["module"] == "app.core.some_module"


def test_json_formatter_includes_request_id():
    """request_id is always present (defaults to 'unset' outside a request)."""
    logger = get_logger("test.rid")
    fields = _capture_log(logger, logging.INFO, "msg")
    assert "request_id" in fields
    assert isinstance(fields["request_id"], str)


def test_json_formatter_request_id_unset_outside_request():
    """Outside a request context, request_id should be 'unset'."""
    from app.core.request_context import _request_id_var
    token = _request_id_var.set("unset")
    try:
        logger = get_logger("test.unset_rid")
        fields = _capture_log(logger, logging.INFO, "msg")
        assert fields["request_id"] == "unset"
    finally:
        _request_id_var.reset(token)


def test_json_formatter_uses_context_request_id():
    """When a request_id is set in the ContextVar, it appears in log output."""
    from app.core.request_context import _request_id_var
    token = _request_id_var.set("req-abc-123")
    try:
        logger = get_logger("test.ctx_rid")
        fields = _capture_log(logger, logging.INFO, "msg")
        assert fields["request_id"] == "req-abc-123"
    finally:
        _request_id_var.reset(token)


def test_json_formatter_output_is_valid_json():
    """Each log line must be parseable as JSON."""
    logger = get_logger("test.json_valid")
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_JsonFormatter())
    logger.addHandler(handler)
    logger.info("valid json test")
    logger.removeHandler(handler)

    raw = stream.getvalue().strip()
    parsed = json.loads(raw)  # raises if invalid
    assert isinstance(parsed, dict)
