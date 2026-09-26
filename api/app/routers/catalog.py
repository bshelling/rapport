from fastapi import APIRouter
from pydantic import BaseModel

from app.catalog import SERVICE_CATALOG, ServiceType

router = APIRouter(tags=["meta"])


class Catalog(BaseModel):
    types: list[ServiceType]


@router.get("/service-catalog")
def service_catalog() -> Catalog:
    return Catalog(types=SERVICE_CATALOG)
