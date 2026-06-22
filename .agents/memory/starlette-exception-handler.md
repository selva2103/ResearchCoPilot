---
name: Starlette exception handler quirk
description: Why @app.exception_handler(Exception) cannot be tested via live HTTP in Starlette 0.40 / FastAPI 0.115, and the correct workaround.
---

## Rule
Do NOT test `@app.exception_handler(Exception)` through the full ASGI/HTTP stack in pytest.
Test the handler **function directly** instead.

## Why
FastAPI 0.115 / Starlette 0.40 registers `@app.exception_handler(Exception)` as
`ServerErrorMiddleware(handler=…)`.  When `ServerErrorMiddleware._send()` calls the
handler and the resulting JSONResponse writes through httpx's ASGITransport in test
mode, a second exception is raised internally; Starlette re-raises the original route
exception (`middleware/errors.py: raise exc`).  The handler IS called (log output
confirms it), but the test client receives an unhandled exception, not a 500 response.

## How to apply
Test the handler as a plain async function:
```python
from app.main import _global_exception_handler
from starlette.requests import Request
scope = {"type":"http","method":"GET","path":"/","query_string":b"","headers":[]}
response = await _global_exception_handler(Request(scope), RuntimeError("boom"))
assert response.status_code == 500
```
Set the ContextVar manually to verify correlation-ID propagation in error responses.

Also: BaseHTTPMiddleware breaks exception handlers in Starlette >=0.28 (anyio task
groups). Use pure ASGI middleware (no BaseHTTPMiddleware) for any middleware that
must not interfere with exception handling.
