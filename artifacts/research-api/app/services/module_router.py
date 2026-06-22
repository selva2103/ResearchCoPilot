"""
Module registry and fan-out router.

Architecture
------------
Research modules (PubMed, GEO, SRA, …) register themselves in ModuleRegistry
at import time. The router checks the cache first; on a miss it calls the
appropriate module handler.

Fan-out
-------
fan_out() calls multiple modules concurrently via asyncio.gather.
It returns *partial results* — if one module fails or times out, the others
are still returned. The caller receives a dict keyed by module name.

Usage
-----
    # Registering a module (future code, in the module file itself):
    # from app.services.module_router import registry
    # registry.register("pubmed", pubmed_handler)

    # Calling modules:
    # results = await fan_out(query="CRISPR", module_names=["pubmed", "geo"])

TODO: integrate Redis cache check before calling registered handlers
TODO: add per-module timeout override (some modules are slower than others)
TODO: support priority queue (critical modules called first, supplementary after)
TODO: Celery task dispatch for long-running module calls
TODO: Prometheus counter per module (calls, errors, timeouts, cache_hits)
"""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.core.request_context import get_request_id
from app.models.error import ErrorDetail, ErrorResponse

logger = get_logger(__name__)


class ModuleRegistry:
    """
    Registry of async research module handlers.

    A *handler* is an async callable with signature:
        async def handler(query: str) -> Any

    Modules register themselves at import time. The registry is intentionally
    empty at startup — modules are added as they are implemented.
    """

    def __init__(self) -> None:
        self._handlers: dict[str, Callable[[str], Awaitable[Any]]] = {}

    def register(self, name: str, handler: Callable[[str], Awaitable[Any]]) -> None:
        """Register a module handler under *name*."""
        self._handlers[name] = handler
        logger.info(f"module registered: {name}")

    def get(self, name: str) -> Callable[[str], Awaitable[Any]] | None:
        """Return the handler for *name*, or None if not registered."""
        return self._handlers.get(name)

    def list_modules(self) -> list[str]:
        """Return names of all registered modules."""
        return list(self._handlers.keys())


# ---------------------------------------------------------------------------
# Global registry — import this in module files to self-register
# ---------------------------------------------------------------------------
registry = ModuleRegistry()

# Future module registrations:
# from app.modules.pubmed import pubmed_handler
# registry.register("pubmed", pubmed_handler)
#
# from app.modules.geo import geo_handler
# registry.register("geo", geo_handler)
#
# from app.modules.sra import sra_handler
# registry.register("sra", sra_handler)
#
# from app.modules.uniprot import uniprot_handler
# registry.register("uniprot", uniprot_handler)


# ---------------------------------------------------------------------------
# Fan-out helper
# ---------------------------------------------------------------------------

async def _safe_call(
    name: str,
    handler: Callable[[str], Awaitable[Any]],
    query: str,
    timeout: float,
) -> tuple[str, Any]:
    """Call *handler* with *timeout*. Returns (name, result_or_error_dict)."""
    try:
        result = await asyncio.wait_for(handler(query), timeout=timeout)
        return name, result
    except asyncio.TimeoutError:
        logger.warning(f"fan_out timeout: module={name}, timeout={timeout}s")
        return name, {"error": "timeout", "module": name}
    except Exception as exc:
        logger.error(f"fan_out error: module={name}, error={exc}")
        return name, {"error": str(exc), "module": name}


async def fan_out(
    query: str,
    module_names: list[str],
    timeout: float | None = None,
) -> dict[str, Any]:
    """
    Call multiple registered modules concurrently for a single *query*.

    Returns a dict keyed by module name. Failed or timed-out modules produce
    an error dict value instead of raising — partial results are always returned.

    Parameters
    ----------
    query:
        The user's research query string.
    module_names:
        Names of modules to call. Unregistered names produce an error entry.
    timeout:
        Per-call timeout in seconds. Defaults to UPSTREAM_TIMEOUT_SECONDS.
    """
    effective_timeout = timeout if timeout is not None else float(settings.UPSTREAM_TIMEOUT_SECONDS)

    tasks = []
    for name in module_names:
        handler = registry.get(name)
        if handler is None:
            # Not registered — include immediately as an error entry
            async def _not_registered(q: str, n: str = name) -> tuple[str, Any]:
                return n, {"error": f"module '{n}' not registered"}
            tasks.append(_not_registered(query))
        else:
            tasks.append(_safe_call(name, handler, query, effective_timeout))

    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    output: dict[str, Any] = {}
    for item in raw_results:
        if isinstance(item, Exception):
            logger.error(f"fan_out gather-level exception: {item}")
        else:
            name, result = item
            output[name] = result

    return output


# ---------------------------------------------------------------------------
# Convenience error builders
# ---------------------------------------------------------------------------

def not_implemented_error(module_name: str) -> ErrorResponse:
    """Return a structured ErrorResponse for an unregistered module."""
    return ErrorResponse(
        error=ErrorDetail(
            code="NOT_IMPLEMENTED",
            message=f"Module '{module_name}' is not yet registered.",
            module=module_name,
            request_id=get_request_id(),
        )
    )
