from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="RAPPORT_", env_file=".env", extra="ignore")

    environment: str = "local"
    version: str = "dev"
    # Origins allowed to call the API directly (local dev). In AWS the web app
    # and API share the CloudFront origin, so no CORS is needed there.
    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
