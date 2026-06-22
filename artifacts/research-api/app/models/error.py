"""
Unified error response model.

Every error returned by this service MUST use this shape:

    {
        "error": {
            "code":       "NOT_IMPLEMENTED",
            "message":    "Module 'pubmed' is not yet registered.",
            "module":     "app.services.module_router",
            "request_id": "550e8400-e29b-41d4-a716-446655440000"
        }
    }

Never return raw stack traces, plain 500 dicts, or ad-hoc error shapes.
The global exception handler in app/main.py enforces this for unhandled errors.
"""

from app.models.base import BaseAPIResponse


class ErrorDetail(BaseAPIResponse):
    """Inner object describing what went wrong."""

    code: str
    """Machine-readable error code, e.g. 'NOT_IMPLEMENTED', 'INTERNAL_ERROR'."""

    message: str
    """Human-readable description of the error."""

    module: str
    """Dotted Python module path that raised or detected the error."""

    request_id: str
    """Correlation ID from the current request context."""


class ErrorResponse(BaseAPIResponse):
    """Top-level error response envelope."""

    error: ErrorDetail
