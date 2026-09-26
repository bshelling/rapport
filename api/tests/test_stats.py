from app.config import get_settings
from app.services import ingest, nola311, stats
from tests.helpers import submit_report

# A square "neighborhood" around the test point, with a hole cut out of its corner.
SQUARE = [[[-90.2, 29.9], [-90.0, 29.9], [-90.0, 30.0], [-90.2, 30.0], [-90.2, 29.9]]]
HOLE = [[-90.05, 29.95], [-90.01, 29.95], [-90.01, 29.99], [-90.05, 29.99], [-90.05, 29.95]]
HOODS = [
    ("UPTOWN", [SQUARE]),
    ("LAKEVIEW", [[[[-89.9, 30.1], [-89.8, 30.1], [-89.8, 30.2], [-89.9, 30.1]]]]),
]


def test_point_in_polygon_with_holes():
    hoods = [("UPTOWN", [[SQUARE[0], HOLE]])]
    assert stats.neighborhood_of(29.9212, -90.1027, hoods) == "UPTOWN"
    assert stats.neighborhood_of(29.97, -90.03, hoods) is None  # inside the hole
    assert stats.neighborhood_of(30.45, -91.18, hoods) is None


def test_display_names():
    assert stats.display_name("MCDONOGH") == "McDonogh"
    assert stats.display_name(stats.norm("St.  Anthony")) == "St. Anthony"


def test_stats_endpoint_before_first_run(client):
    assert client.get("/api/stats").status_code == 404


def test_compute_and_serve(client, monkeypatch):
    # Two open City drainage requests in "Uptown" (mirrored via the import).
    def row(ticket, reason="Catch Basin Clogged"):
        return {
            "service_request": ticket,
            "request_reason": reason,
            "request_status": "Pending",
            "date_created": "2026-09-20T10:00:00.000",
            "date_modified": "2026-09-20T10:00:00.000",
            "latitude": "29.9212",
            "longitude": "-90.1027",
        }

    monkeypatch.setattr(
        nola311,
        "fetch_since",
        lambda f, s: iter([row("2026-1"), row("2026-2"), row("2026-3", "Pothole")]),
    )
    ingest.run()
    submit_report(client)

    monkeypatch.setattr(stats, "load_neighborhoods", lambda: HOODS)
    monkeypatch.setattr(stats, "basins_by_neighborhood", lambda: {"UPTOWN": 400, "LAKEVIEW": 900})
    monkeypatch.setattr(stats, "median_days_to_close", lambda since: {"Pothole": 13.0})
    monkeypatch.setattr(stats, "_count", lambda where: 314 if "2024-09" in where else 102)
    computed = stats.compute()

    assert computed["open_drainage_requests"] == 2
    assert computed["open_drainage_by_neighborhood"] == [
        {"neighborhood": "Uptown", "open_requests": 2, "basins": 400, "per_100_basins": 0.5}
    ]
    assert computed["francine"]["multiplier"] == 3.1
    assert computed["rapport"] == {
        "reports": 1,
        "supporters": 0,
        "filed_with_311": 0,
        "resolved": 0,
    }

    served = client.get("/api/stats").json()
    assert served["open_drainage_requests"] == 2
    assert served["median_days_to_close"]["Pothole"] == 13.0


def test_import_only_computes_stats_in_live_mode(client, monkeypatch):
    called = []
    monkeypatch.setattr(stats, "compute", lambda: called.append(1))
    monkeypatch.setattr(nola311, "fetch_since", lambda f, s: iter([]))
    ingest.run()
    assert called == []
    monkeypatch.setenv("RAPPORT_NOLA311_MODE", "live")
    get_settings.cache_clear()
    monkeypatch.setattr(ingest, "suggest_links", lambda: 0)
    assert ingest.run()["stats"] == "ok" and called == [1]


def test_drainage_reports_get_the_nearest_basin(client, monkeypatch):
    monkeypatch.setenv("RAPPORT_NOLA311_MODE", "live")
    get_settings.cache_clear()
    basin = {"gisid": "CB113806", "street": "Jena St", "neighborhood": "UPTOWN", "distance_m": 5.4}
    monkeypatch.setattr(nola311, "nearest_basin", lambda lat, lng: basin)
    report = submit_report(client)
    detail = client.get(f"/api/reports/{report['id']}", headers={"X-Dev-User": "user-1"}).json()
    assert detail["basin"] == basin

    def down(lat, lng):
        raise TimeoutError

    monkeypatch.setattr(nola311, "nearest_basin", down)
    assert submit_report(client)["id"]  # the City API failing never blocks a report

    pothole = submit_report(client, reason=("Roads and Streets", "Pothole"))
    detail = client.get(f"/api/reports/{pothole['id']}", headers={"X-Dev-User": "user-1"}).json()
    assert detail["basin"] is None
