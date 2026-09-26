import pytest

from app.services import geo
from tests.conftest import dev_headers
from tests.helpers import submit_report

ME = dev_headers("user-1", "user-1@example.com")


@pytest.fixture(autouse=True)
def fake_geo():
    geo.get_geo.cache_clear()
    yield
    geo.get_geo.cache_clear()


def test_geo_endpoints_require_sign_in(client):
    assert client.get("/api/geo/suggest?q=magazine").status_code == 401
    assert client.get("/api/geo/reverse?lat=29.92&lng=-90.10").status_code == 401


def test_suggest_and_place(client):
    res = client.get("/api/geo/suggest?q=magazine", headers=ME)
    assert res.status_code == 200
    [s] = res.json()["suggestions"]
    assert s["title"].startswith("Magazine St & Napoleon Ave")
    place = client.get(f"/api/geo/place/{s['place_id']}", headers=ME).json()
    assert place == {"lat": 29.9208, "lng": -90.1016, "address": "Magazine St & Napoleon Ave"}
    assert client.get("/api/geo/place/unknown", headers=ME).status_code == 404
    assert client.get("/api/geo/suggest?q=ab", headers=ME).status_code == 422


def test_reverse(client):
    res = client.get("/api/geo/reverse?lat=29.9212&lng=-90.1027", headers=ME)
    assert res.json() == {"address": "Near 29.9212, -90.1027"}
    outside = client.get("/api/geo/reverse?lat=30.45&lng=-91.18", headers=ME)
    assert outside.status_code == 422


class _Stub:
    def __init__(self, **responses):
        self.responses = responses
        self.calls = []

    def __getattr__(self, name):
        def call(**kwargs):
            self.calls.append((name, kwargs))
            return self.responses[name]

        return call


def _live(stub):
    g = geo.LocationServiceGeo.__new__(geo.LocationServiceGeo)
    g.client = stub
    return g


MAGAZINE_4000 = "4000 Magazine St, New Orleans, LA 70115-2749, United States"
INTERSECTION = "Magazine St & Napoleon Ave, New Orleans, LA 70115, United States"


def test_location_service_parsing():
    # Shapes taken from real geo-places responses for New Orleans.
    stub = _Stub(
        autocomplete={
            "ResultItems": [
                {
                    "PlaceId": "AQAAAGIA",
                    "Title": "United States, LA, 70115-2749, New Orleans, 4000 Magazine St",
                    "Address": {
                        "Label": "4000 Magazine St, New Orleans, LA 70115-2749, United States"
                    },
                }
            ]
        },
        get_place={
            "Position": [-90.1016, 29.9208],
            "Address": {
                "Label": "Magazine St & Napoleon Ave, New Orleans, LA 70115, United States"
            },
        },
        reverse_geocode={
            "ResultItems": [
                {"Address": {"Label": "918 Jena St, New Orleans, LA 70115-2812, United States"}}
            ]
        },
    )
    g = _live(stub)
    [s] = g.suggest("4000 Magaz")
    assert s.title == MAGAZINE_4000
    assert stub.calls[0][1]["Filter"]["BoundingBox"] == [-90.15, 29.86, -89.62, 30.2]
    place = g.place("AQAAAGIA")
    assert (place.lat, place.lng, place.address) == (
        29.9208,
        -90.1016,
        "Magazine St & Napoleon Ave",
    )
    assert g.reverse(29.9212, -90.1027) == "918 Jena St"
    assert stub.calls[-1][1]["QueryPosition"] == [-90.1027, 29.9212]  # lng, lat order


def test_place_outside_new_orleans_is_rejected():
    stub = _Stub(get_place={"Position": [-91.18, 30.45], "Address": {"Label": "Baton Rouge"}})
    assert _live(stub).place("x") is None


def test_public_map_is_anonymous_and_rounded(client):
    report = submit_report(client, photo=False)
    res = client.get("/api/map/reports")  # no sign-in needed
    assert res.status_code == 200
    body = res.json()
    [pin] = body["reports"]
    assert body["truncated"] is False
    assert pin["id"] == report["id"]
    assert (pin["lat"], pin["lng"]) == (29.9212, -90.1027)
    assert set(pin) == {
        "id",
        "source",
        "request_type",
        "request_reason",
        "status",
        "lat",
        "lng",
        "supporter_count",
        "created_at",
    }


def test_public_map_bbox_and_duplicates(client, table):
    a = submit_report(client)
    b = submit_report(client, user="user-2")
    table.update_item(
        Key={"PK": f"REPORT#{b['id']}", "SK": "META"},
        UpdateExpression="SET #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "closed_duplicate"},
    )
    ids = [r["id"] for r in client.get("/api/map/reports").json()["reports"]]
    assert ids == [a["id"]]
    inside = client.get("/api/map/reports?bbox=-90.2,29.9,-90.0,30.0").json()["reports"]
    assert len(inside) == 1
    outside = client.get("/api/map/reports?bbox=-90.0,29.95,-89.9,30.0").json()["reports"]
    assert outside == []
    assert client.get("/api/map/reports?bbox=1,2,3").status_code == 422
    assert client.get("/api/map/reports?bbox=-90.0,29.9,-90.2,30.0").status_code == 422
