from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="RAPPORT_", env_file=".env", extra="ignore")

    environment: str = "local"
    version: str = "dev"
    # Origins allowed to call the API directly (local dev). In AWS the web app
    # and API share the CloudFront origin, so no CORS is needed there.
    cors_origins: list[str] = ["http://localhost:3000"]

    aws_region: str = "us-east-1"
    table_name: str = "rapport-local"
    photo_bucket: str = "rapport-photos-local"

    # How the caller is identified:
    #   apigw - API Gateway's JWT authorizer already validated the token (AWS)
    #   jwt   - verify the Cognito ID token here (local dev against real Cognito)
    #   dev   - trust an X-Dev-User header (tests / offline; never in AWS)
    auth_mode: Literal["apigw", "jwt", "dev"] = "dev"
    cognito_issuer: str = ""
    cognito_client_id: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
