"""
Request correlation ID middleware and context variable.

Every incoming request gets a unique correlation ID:
  - Re-uses the value of the X-Request-ID header if present.
  - Otherwise generates a UUID4.

The ID is stored in a ContextVar so any downstream function can call
get_request_id() without the ID being threaded through every call stack.

The middleware also echoes the ID back in the X-Request-ID response header.

Implementation note — pure ASGI middleware (NOT BaseHTTPMiddleware):
  Starlette ≥0.28 with anyio runs BaseHTTPMiddleware inside a TaskGroup.
  Exceptions raised by route handlers propagate through the TaskGroup before
  the app-level exception handler can return a JSONResponse, causing them to
  escape the middleware layer entirely. A pure ASGI middleware avoids this by
  wrapping scope/receive/send directly, so exception handlers remain effective.

TODO: add OpenTelemetry span ID propagation here
TODO: add W3C TraceContext (traceparent / tracestate) header support
"""

import uuid
from contextvars import ContextVar
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Receive, Scope, Send

# Module-level ContextVar — default "unset" when called outside a request
_request_id_var: ContextVar[str] = ContextVar("request_id", default="unset")


def get_request_id() -> str:
    """Return the correlation ID for the current request, or 'unset'."""
    return _request_id_var.get()


class RequestIDMiddleware:
    """
    Pure ASGI middleware that assigns a correlation ID to every HTTP request.

    Reads X-Request-ID from incoming headers; generates a UUID4 if absent.
    Sets the ContextVar for the duration of the request, then resets it.
    Appends X-Request-ID to the outgoing response headers.

    Uses pure ASGI rather than BaseHTTPMiddleware so that FastAPI's
    global exception handler can still return structured error responses
    even when route handlers raise unhandled exceptions.
    """

    def __init__(self, app: "ASGIApp") -> None:
        self.app = app

    async def __call__(
        self, scope: "Scope", receive: "Receive", send: "Send"
    ) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        # Extract or generate a correlation ID
        headers = dict(scope.get("headers", []))
        incoming = headers.get(b"x-request-id", b"").decode()
        request_id = incoming or str(uuid.uuid4())

        token = _request_id_var.set(request_id)

        async def send_with_id(message: dict) -> None:
            if message["type"] == "http.response.start":
                raw_headers: list = list(message.get("headers", []))
                raw_headers.append((b"x-request-id", request_id.encode()))
                message = {**message, "headers": raw_headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            _request_id_var.reset(token)
