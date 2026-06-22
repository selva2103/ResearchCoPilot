"""
Structured JSON logging for the Research API.

Every log line includes: timestamp, level, request_id, module, message.
The request_id is pulled from the request-scoped ContextVar set by the
RequestIDMiddleware — outside a request context it falls back to "unset".

Usage:
    from app.core.logging import get_logger
    logger = get_logger(__name__)
    logger.info("cache hit", extra={"key": "pubmed:abc123"})

Never use print() anywhere in this codebase.

TODO: add OpenTelemetry log bridge when tracing is introduced
TODO: add Prometheus log-based metrics counter
"""

import json
import logging
import time

# Import at function-call time to break potential circular import at module load
def _get_request_id() -> str:
    try:
        from app.core.request_context import get_request_id  # noqa: PLC0415
        return get_request_id()
    except Exception:
        return "unset"


class _JsonFormatter(logging.Formatter):
    """Formats each log record as a single JSON line."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)
            ),
            "level": record.levelname,
            "request_id": _get_request_id(),
            "module": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            log_entry["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(log_entry)


def get_logger(module_name: str) -> logging.Logger:
    """
    Return a logger configured for structured JSON output.

    Idempotent — calling this multiple times with the same name returns the
    same logger without adding duplicate handlers.
    """
    logger = logging.getLogger(module_name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(_JsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger
