"""
Centralised application configuration via environment variables.

All settings have safe defaults so the service starts without any env file.
Set NCBI_API_KEY to raise the NCBI Entrez rate limit from 3 req/s to 10 req/s.

TODO: add Celery broker URL when background task queue is introduced
TODO: add Postgres DSN when result persistence is added
TODO: add OpenTelemetry collector endpoint
TODO: add Prometheus push-gateway URL
"""

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Redis — used for caching and rate-limiting across worker processes
    REDIS_URL: str = "redis://localhost:6379"

    # CORS — comma-separated list of allowed origins (also accepts a JSON array)
    # Supports localhost dev ports and Replit proxy domains via env var override
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:5000",
        "http://localhost:20891",
    ]

    # Replit dev domain — set automatically in the Replit environment
    REPLIT_DEV_DOMAIN: str | None = None

    # Cache TTL: 24 hours by default
    CACHE_TTL_SECONDS: int = 86_400

    # Optional NCBI API key — raises Entrez rate limit ceiling from 3 → 10 req/s
    NCBI_API_KEY: str | None = None

    # Max seconds to wait for an upstream HTTP response before aborting
    UPSTREAM_TIMEOUT_SECONDS: int = 20

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_cors(cls, v: object) -> list[str]:
        """Accept CSV strings from env vars, e.g. CORS_ORIGINS=http://a.com,http://b.com"""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v  # type: ignore[return-value]


settings = Settings()
