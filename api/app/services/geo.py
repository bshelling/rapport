"""Address search and (reverse) geocoding with Amazon Location Service, limited to
New Orleans. No Location resources are needed for the geo-places API."""

from functools import lru_cache
from typing import Protocol

import boto3

from app.config import get_settings
from app.geo import NOLA_BOUNDS, in_new_orleans
from app.models.geo import Place, PlaceSuggestion

# [west, south, east, north] as Amazon Location expects.
_BBOX = [
    NOLA_BOUNDS["min_lng"],
    NOLA_BOUNDS["min_lat"],
    NOLA_BOUNDS["max_lng"],
    NOLA_BOUNDS["max_lat"],
]


def _short_address(label: str | None) -> str | None:
    # "918 Jena St, New Orleans, LA 70115-2812, United States" -> "918 Jena St"
    return label.split(",")[0].strip() if label else None


class Geo(Protocol):
    def suggest(self, query: str) -> list[PlaceSuggestion]: ...
    def place(self, place_id: str) -> Place | None: ...
    def reverse(self, lat: float, lng: float) -> str | None: ...


class LocationServiceGeo:
    def __init__(self, region: str):
        self.client = boto3.client("geo-places", region_name=region)

    def suggest(self, query: str) -> list[PlaceSuggestion]:
        res = self.client.autocomplete(
            QueryText=query, MaxResults=5, Filter={"BoundingBox": _BBOX}, Language="en"
        )
        out = []
        for item in res.get("ResultItems", []):
            address = item.get("Address", {})
            title = address.get("Label") or item.get("Title", "")
            out.append(PlaceSuggestion(place_id=item["PlaceId"], title=title))
        return out

    def place(self, place_id: str) -> Place | None:
        res = self.client.get_place(PlaceId=place_id, Language="en")
        lng, lat = res["Position"]
        if not in_new_orleans(lat, lng):
            return None
        return Place(lat=lat, lng=lng, address=_short_address(res.get("Address", {}).get("Label")))

    def reverse(self, lat: float, lng: float) -> str | None:
        res = self.client.reverse_geocode(QueryPosition=[lng, lat], MaxResults=1, Language="en")
        items = res.get("ResultItems", [])
        return _short_address(items[0].get("Address", {}).get("Label")) if items else None


class FakeGeo:
    """Deterministic stand-in for local dev and tests."""

    PLACES = {
        "fake-magazine-napoleon": Place(
            lat=29.9208, lng=-90.1016, address="Magazine St & Napoleon Ave"
        ),
        "fake-jackson-square": Place(lat=29.9574, lng=-90.0629, address="Jackson Square"),
    }

    def suggest(self, query: str) -> list[PlaceSuggestion]:
        q = query.lower()
        return [
            PlaceSuggestion(place_id=pid, title=f"{p.address}, New Orleans, LA")
            for pid, p in self.PLACES.items()
            if any(word in (p.address or "").lower() for word in q.split())
        ]

    def place(self, place_id: str) -> Place | None:
        return self.PLACES.get(place_id)

    def reverse(self, lat: float, lng: float) -> str | None:
        return f"Near {lat:.4f}, {lng:.4f}"


@lru_cache
def get_geo() -> Geo:
    settings = get_settings()
    if settings.geo_mode == "fake":
        return FakeGeo()
    return LocationServiceGeo(settings.aws_region)
