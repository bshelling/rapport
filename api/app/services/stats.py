"""Impact numbers for the home page, computed nightly after the 311 import.

Everything here comes from the City's open data (data.nola.gov) plus Rapport's
own reports, and is stored as one STATS#latest item that GET /api/stats serves.
"""

import json
import logging
import statistics
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from boto3.dynamodb.conditions import Key

from app.db import from_dynamo, get_table, to_dynamo
from app.neighborhoods import NEIGHBORHOODS
from app.services import nola311

log = logging.getLogger(__name__)

STATS_KEY = {"PK": "STATS#latest", "SK": "META"}
DRAINAGE_REASONS = [
    "Catch Basin Not Draining",
    "Catch Basin Clogged",
    "Catch Basin Frame and Cover Missing or Damaged",
    "Drainage Manhole Cover Missing or Damaged",
    "Street Flooding",
]
BASINS_URL = "https://data.nola.gov/resource/se4p-ierc.json"
NEIGHBORHOODS_URL = "https://data.nola.gov/resource/exvn-jeh2.json"
# Hurricane Francine made landfall Sept 11, 2024.
FRANCINE = ("2024-09-10T00:00:00", "2024-09-20T23:59:59")
BASELINE = ("2024-08-10T00:00:00", "2024-08-20T23:59:59")


def _get(url: str, params: dict) -> list[dict]:
    return nola311._fetch(params, url=url)


def norm(name: str | None) -> str:
    return " ".join((name or "").upper().split())


_DISPLAY = {norm(n): n for n in NEIGHBORHOODS}


def display_name(key: str) -> str:
    return _DISPLAY.get(key, key.title())


# --- Neighborhoods (point in polygon) ----------------------------------------------


def load_neighborhoods() -> list[tuple[str, list]]:
    rows = _get(NEIGHBORHOODS_URL, {"$select": "gnocdc_lab, the_geom", "$limit": 200})
    return [(norm(r["gnocdc_lab"]), r["the_geom"]["coordinates"]) for r in rows]


def _in_ring(lng: float, lat: float, ring: list) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def neighborhood_of(lat: float, lng: float, hoods: list[tuple[str, list]]) -> str | None:
    for name, multipolygon in hoods:
        for polygon in multipolygon:
            outer, *holes = polygon
            if _in_ring(lng, lat, outer) and not any(_in_ring(lng, lat, h) for h in holes):
                return name
    return None


# --- City aggregates -------------------------------------------------------------------


def _soql_list(values: list[str]) -> str:
    return nola311._soql_list(values)


def _count(where: str) -> int:
    rows = _get(nola311.DATASET_URL, {"$select": "count(*) AS n", "$where": where})
    return int(rows[0]["n"]) if rows else 0


def francine() -> dict:
    drainage = "request_type = 'Drainage' AND date_created between '{}' and '{}'"
    storm = _count(drainage.format(*FRANCINE))
    before = _count(drainage.format(*BASELINE))
    not_draining = _count(
        f"request_reason = 'Catch Basin Not Draining' AND date_created between "
        f"'{FRANCINE[0]}' and '{FRANCINE[1]}'"
    )
    return {
        "drainage_requests": storm,
        "baseline_requests": before,
        "multiplier": round(storm / before, 1) if before else None,
        "catch_basin_not_draining": not_draining,
        "window": "Sept 10–20, 2024",
        "baseline_window": "Aug 10–20, 2024",
    }


def median_days_to_close(since: str) -> dict[str, float]:
    rows = _get(
        nola311.DATASET_URL,
        {
            "$select": "request_reason, date_created, date_modified",
            "$where": f"request_status = 'Closed' AND date_created >= '{since}' AND "
            f"request_reason in ({_soql_list(nola311.REASONS)})",
            "$limit": 50000,
        },
    )
    days: dict[str, list[float]] = {}
    for r in rows:
        try:
            created = datetime.fromisoformat(r["date_created"].split(".")[0])
            closed = datetime.fromisoformat(r["date_modified"].split(".")[0])
        except (KeyError, ValueError):
            continue
        days.setdefault(r["request_reason"], []).append(max((closed - created).days, 0))
    return {reason: float(statistics.median(v)) for reason, v in days.items() if v}


def basins_by_neighborhood() -> dict[str, int]:
    rows = _get(
        BASINS_URL,
        {"$select": "neighborhood, count(*) AS n", "$group": "neighborhood", "$limit": 200},
    )
    return {norm(r.get("neighborhood")): int(r["n"]) for r in rows if r.get("neighborhood")}


def open_drainage_by_neighborhood(hoods) -> tuple[int, dict[str, int]]:
    """Open City drainage requests (mirrored MAP311 partition): total and per neighborhood."""
    table = get_table()
    counts: dict[str, int] = {}
    total = 0
    kwargs: dict = {"IndexName": "GSI3", "KeyConditionExpression": Key("GSI3PK").eq("MAP311")}
    while True:
        res = table.query(**kwargs)
        for item in res["Items"]:
            if item.get("request_type") != "Drainage":
                continue
            total += 1
            loc = from_dynamo(item["location"])
            name = neighborhood_of(loc["lat"], loc["lng"], hoods)
            if name:
                counts[name] = counts.get(name, 0) + 1
        if "LastEvaluatedKey" not in res:
            return total, counts
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def rapport_numbers() -> dict:
    table = get_table()
    items: list[dict] = []
    kwargs: dict = {"IndexName": "GSI3", "KeyConditionExpression": Key("GSI3PK").eq("MAP")}
    while True:
        res = table.query(**kwargs)
        items += res["Items"]
        if "LastEvaluatedKey" not in res:
            break
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]
    # Test and demo data don't count toward Rapport's numbers: the Playwright user's
    # reports exist in prod only while a deploy's tests run.
    real = [
        i
        for i in items
        if not str(i.get("id", "")).startswith("e2e-")
        and not i.get("sample")
        and (i.get("contact") or {}).get("email") != "e2e@example.com"
    ]
    return {
        "reports": len(real),
        "supporters": sum(int(i.get("supporter_count", 0)) for i in real),
        "filed_with_311": sum(1 for i in real if i.get("nola311_ticket")),
        "resolved": sum(1 for i in real if i.get("status") == "resolved"),
    }


# --- Compute & serve ---------------------------------------------------------------


def compute() -> dict:
    now = datetime.now(UTC)
    hoods = load_neighborhoods()
    basins = basins_by_neighborhood()
    open_total, open_by_hood = open_drainage_by_neighborhood(hoods)
    ranking = sorted(
        (
            {
                "neighborhood": display_name(name),
                "open_requests": n,
                "basins": basins[name],
                "per_100_basins": round(100 * n / basins[name], 1),
            }
            for name, n in open_by_hood.items()
            # Tiny areas with a handful of basins would dominate a per-basin ranking.
            if basins.get(name, 0) >= 200
        ),
        key=lambda r: r["per_100_basins"],
        reverse=True,
    )
    month_start = now.strftime("%Y-%m-01T00:00:00")
    year_ago = (now - timedelta(days=365)).strftime("%Y-%m-%dT00:00:00")
    medians = median_days_to_close(year_ago)
    stats = {
        "computed_at": now.isoformat(timespec="seconds"),
        "open_drainage_requests": open_total,
        "open_drainage_by_neighborhood": ranking[:10],
        "total_basins": sum(basins.values()),
        "median_days_to_close": medians,
        "potholes_this_month": {
            "reported": _count(f"request_reason = 'Pothole' AND date_created >= '{month_start}'"),
            "closed": _count(
                f"request_reason = 'Pothole' AND request_status = 'Closed' AND "
                f"date_modified >= '{month_start}'"
            ),
        },
        "francine": francine(),
        "rapport": rapport_numbers(),
    }
    get_table().put_item(Item=to_dynamo({**STATS_KEY, "data": json.loads(json.dumps(stats))}))
    log.info(
        "stats computed: %s open drainage (%s outside neighborhood polygons), %d ranked",
        open_total,
        open_total - sum(open_by_hood.values()),
        len(ranking),
    )
    return stats


def latest() -> dict | None:
    item = get_table().get_item(Key=STATS_KEY).get("Item")
    if not item:
        return None
    data = from_dynamo(item["data"])
    # Keep float formatting stable for JSON (Decimal -> float/int).
    return json.loads(json.dumps(data, default=lambda o: float(o) if isinstance(o, Decimal) else o))
