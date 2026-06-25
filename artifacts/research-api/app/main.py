"""
FastAPI application entry point.

Middleware order (outermost → innermost):
    CORSMiddleware      — handles pre-flight and CORS headers
    RequestIDMiddleware — generates / extracts correlation ID

The global exception handler ensures every unhandled error returns an
ErrorResponse — never a raw stack trace or unstructured 500 body.

TODO: add OpenTelemetry instrumentation middleware
TODO: add Prometheus /metrics endpoint (prometheus-fastapi-instrumentator)
TODO: add Celery worker startup in lifespan when task queue is introduced
TODO: add Postgres connection pool startup in lifespan
TODO: add request analytics middleware (log query patterns, latencies)
"""

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.core.config import settings
from app.core.http_client import close_http_client
from app.core.logging import get_logger
from app.core.request_context import RequestIDMiddleware, get_request_id
from app.models.error import ErrorDetail, ErrorResponse

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and graceful shutdown."""
    app.state.start_time = time.time()
    logger.info("Research API starting up")
    yield
    await close_http_client()
    logger.info("Research API shutting down")


app = FastAPI(
    title="Research API",
    description=(
        "Infrastructure skeleton for ResearchCoPilot backend modules. "
        "PubMed, GEO, SRA, and AI reasoning layers plug in here."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# ── Middleware (added last → executed first) ────────────────────────────────

cors_origins = list(settings.CORS_ORIGINS)
if settings.REPLIT_DEV_DOMAIN:
    cors_origins.append(f"https://{settings.REPLIT_DEV_DOMAIN}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https://.*\.replit\.dev",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RequestIDMiddleware)

# ── Global exception handler ────────────────────────────────────────────────


@app.exception_handler(Exception)
async def _global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch all unhandled exceptions and return a structured ErrorResponse."""
    logger.error(f"unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error=ErrorDetail(
                code="INTERNAL_ERROR",
                message="An unexpected error occurred.",
                module="app.main",
                request_id=get_request_id(),
            )
        ).model_dump(),
    )


# ── Routers ─────────────────────────────────────────────────────────────────

app.include_router(router)
