from pydantic import BaseModel


class PlaceSuggestion(BaseModel):
    place_id: str
    title: str


class Place(BaseModel):
    lat: float
    lng: float
    address: str | None
