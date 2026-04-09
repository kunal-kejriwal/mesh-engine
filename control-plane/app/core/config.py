from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "MeshEngine"
    version: str = "1.0.0"

    database_url: str = "postgresql+asyncpg://meshuser:meshpass@localhost/meshengine"
    redis_url: str = "redis://localhost:6379"
    log_level: str = "INFO"

    # Topology defaults
    default_link_threshold: float = 150.0  # Euclidean distance units
    latency_distance_factor: float = 0.5   # ms per distance unit

    # Auth
    jwt_secret: str = "change-me-in-production-use-a-long-random-string"
    jwt_expiry_seconds: int = 3600  # 1 hour

    # Rate limiting
    rate_limit_requests: int = 10
    rate_limit_window_seconds: int = 60

    model_config = {"env_file": ".env"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
