from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from app.config import get_settings
from app.routers import health


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Rapport API",
        version=settings.version,
        # Everything is served under /api so CloudFront can route it.
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    app.include_router(health.router, prefix="/api")
    return app


app = create_app()

# AWS Lambda entry point (API Gateway HTTP API, payload v2).
handler = Mangum(app, lifespan="off")
