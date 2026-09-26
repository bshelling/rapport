from fastapi import APIRouter
from pydantic import BaseModel

from app.neighborhoods import NEIGHBORHOODS

router = APIRouter(tags=["meta"])


class Neighborhoods(BaseModel):
    neighborhoods: list[str]


@router.get("/neighborhoods")
def list_neighborhoods() -> Neighborhoods:
    return Neighborhoods(neighborhoods=list(NEIGHBORHOODS))
