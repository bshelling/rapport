from app.catalog import is_valid_pair
from app.geo import geohash, in_new_orleans
from app.html import plain_text, sanitize


def test_service_catalog_is_public_and_uses_city_strings(client):
    res = client.get("/api/service-catalog")
    assert res.status_code == 200
    types = {t["name"]: [r["name"] for r in t["reasons"]] for t in res.json()["types"]}
    assert types["Roads and Streets"] == [
        "Pothole",
        "Sidewalk Damaged or Missing",
        "Street Subsidence (Sinking)",
    ]
    assert len(types["Drainage"]) == 5
    assert "Catch Basin Clogged" in types["Drainage"]


def test_reason_must_belong_to_type():
    assert is_valid_pair("Drainage", "Street Flooding")
    assert not is_valid_pair("Roads and Streets", "Street Flooding")
    assert not is_valid_pair(None, "Pothole")


def test_geohash_matches_reference_value():
    # Reference example from the geohash spec.
    assert geohash(57.64911, 10.40744, 11) == "u4pruydqqvj"
    assert geohash(29.9212, -90.1027, 6) == "9vrfjw"


def test_new_orleans_bounds():
    assert in_new_orleans(29.9511, -90.0715)  # CBD
    assert not in_new_orleans(30.4515, -91.1871)  # Baton Rouge


def test_sanitize_keeps_formatting_and_drops_everything_else():
    dirty = '<p onclick="x()">Big <strong>hole</strong><script>alert(1)</script></p><img src=x>'
    assert sanitize(dirty) == "<p>Big <strong>hole</strong></p>"
    assert plain_text("<p>Big&nbsp;<em>hole</em></p><ul><li>deep</li></ul>") == "Big hole deep"
