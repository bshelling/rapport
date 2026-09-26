from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.auth import CurrentUserDep
from app.geo import in_new_orleans
from app.models.geo import Place, PlaceSuggestion
from app.services.geo import get_geo

# Signed-in only: every lookup is billed.
router = APIRouter(prefix="/geo", tags=["geo"])


class Suggestions(BaseModel):
    suggestions: list[PlaceSuggestion]


class ReverseResult(BaseModel):
    address: str | None


@router.get("/suggest")
def suggest(
    q: Annotated[str, Query(min_length=3, max_length=100)], user: CurrentUserDep
) -> Suggestions:
    return Suggestions(suggestions=get_geo().suggest(q))


@router.get("/place/{place_id}")
def place(place_id: str, user: CurrentUserDep) -> Place:
    result = get_geo().place(place_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Place not found in New Orleans")
    return result


@router.get("/reverse")
def reverse(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lng: Annotated[float, Query(ge=-180, le=180)],
    user: CurrentUserDep,
) -> ReverseResult:
    if not in_new_orleans(lat, lng):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Location must be in New Orleans"
        )
    return ReverseResult(address=get_geo().reverse(lat, lng))
