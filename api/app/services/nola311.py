"""NOLA 311 open data (data.nola.gov, Socrata dataset 2jgv-pqrq).

City service requests for the reasons Rapport covers are mirrored into the
table as NOLA311#{ticket} items so they show up in duplicate checks, on the
map, and can drive status updates for Rapport reports that were filed with 311.
"""

import json
import logging
import ssl
import urllib.parse
import urllib.request
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import lru_cache

import certifi

from app.catalog import REASONS_BY_TYPE
from app.geo import geohash, in_new_orleans

log = logging.getLogger(__name__)

DATASET_URL = "https://data.nola.gov/resource/2jgv-pqrq.json"
PAGE_SIZE = 5000
REASONS = sorted({r for reasons in REASONS_BY_TYPE.values() for r in reasons})
_TYPE_OF = {r: t for t, reasons in REASONS_BY_TYPE.items() for r in reasons}


def _soql_list(values: list[str]) -> str:
    return ",".join("'" + v.replace("'", "''") + "'" for v in values)


@lru_cache
def _ssl() -> ssl.SSLContext:
    # certifi's CA bundle: some Python builds ship without system certificates.
    return ssl.create_default_context(cafile=certifi.where())


def _fetch(params: dict, timeout: float = 30.0, url: str = DATASET_URL) -> list[dict]:
    url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})  # noqa: S310
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl()) as res:  # noqa: S310
        return json.loads(res.read())


def fetch_since(field: str, since: str) -> Iterator[dict]:
    """All covered requests with `field` (date_created / date_modified) after `since`."""
    where = f"request_reason in ({_soql_list(REASONS)}) AND {field} > '{since}'"
    offset = 0
    while True:
        page = _fetch(
            {
                "$where": where,
                "$order": f"{field}, service_request",
                "$limit": PAGE_SIZE,
                "$offset": offset,
            }
        )
        yield from page
        if len(page) < PAGE_SIZE:
            return
        offset += PAGE_SIZE


def fetch_ticket(ticket: str, timeout: float = 4.0) -> dict | None:
    rows = _fetch({"service_request": ticket, "$limit": 1}, timeout=timeout)
    return rows[0] if rows else None


def _iso(value: str | None) -> str | None:
    # Socrata floating timestamps ("2026-09-25T19:41:50.000") are local city time;
    # keep them as-is (no zone) so comparisons with the source stay exact.
    return value.split(".")[0] if value else None


def to_item(row: dict) -> dict | None:
    """Map a Socrata row to a table item; None if it can't be placed on the map."""
    reason = row.get("request_reason")
    ticket = row.get("service_request")
    try:
        lat, lng = float(row["latitude"]), float(row["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    if reason not in _TYPE_OF or not ticket or not in_new_orleans(lat, lng):
        return None
    request_type = _TYPE_OF[reason]
    created = _iso(row.get("date_created"))
    open_ = row.get("request_status") == "Pending"
    item = {
        "PK": f"NOLA311#{ticket}",
        "SK": "META",
        "GSI2PK": f"GEO#{geohash(lat, lng, 6)}",
        "GSI2SK": f"TYPE#{request_type}#{created}",
        "id": ticket,
        "source": "nola311",
        "nola311_ticket": ticket,
        "request_type": request_type,
        "request_reason": reason,
        "request_status": row.get("request_status"),
        # Normalized to Rapport statuses so shared queries (duplicates, map) just work.
        "status": "filed_with_311" if open_ else "resolved",
        "location": {"lat": Decimal(str(lat)), "lng": Decimal(str(lng))},
        "address": row.get("final_address"),
        "council_district": row.get("address_councildis"),
        "created_at": created,
        "modified_at": _iso(row.get("date_modified")),
        "synced_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    if open_:
        # Open City requests appear on the public map (separate partition from residents').
        item["GSI3PK"] = "MAP311"
        item["GSI3SK"] = created
    return item


def open_requests_near(
    lat: float, lng: float, request_type: str, radius_m: int, days: int, timeout: float = 4.0
) -> list[dict]:
    """Open City requests of this type near a point, straight from the live dataset.

    The nightly import can be a day behind; this catches requests filed since.
    Items have the same shape as imported ones (to_item).
    """
    since = (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
    reasons = ", ".join(f"'{r}'" for r, t in _TYPE_OF.items() if t == request_type)
    rows = _fetch(
        {
            "$where": f"within_circle(geocoded_column, {lat}, {lng}, {radius_m}) "
            f"AND request_status = 'Pending' AND request_reason IN ({reasons}) "
            f"AND date_created > '{since}'",
            "$limit": 20,
        },
        timeout=timeout,
    )
    return [item for item in (to_item(r) for r in rows) if item]


BASINS_URL = "https://data.nola.gov/resource/se4p-ierc.json"


def nearest_basin(lat: float, lng: float, radius_m: int = 40) -> dict | None:
    """Closest City catch basin to a point (for drainage reports), or None."""
    from app.geo import distance_m

    rows = _fetch(
        {
            "$select": "gisid, stname, neighborhood, the_geom",
            "$where": f"within_circle(the_geom, {lat}, {lng}, {radius_m})",
            "$limit": 20,
        },
        timeout=3.0,
        url=BASINS_URL,
    )
    best = None
    for r in rows:
        blng, blat = r["the_geom"]["coordinates"]
        d = distance_m(lat, lng, blat, blng)
        if best is None or d < best["distance_m"]:
            best = {
                "gisid": r.get("gisid"),
                "street": (r.get("stname") or "").title() or None,
                "neighborhood": r.get("neighborhood"),
                "distance_m": round(d, 1),
            }
    return best
