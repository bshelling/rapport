"""Sample reports for the demo account and the public map, labeled as samples in the UI.

Reports with a NOLA 311 number mirror real City requests (same number, same spot), so the
nightly sync keeps their status honest. Sample reports never count toward Rapport's numbers
and are never offered to residents as duplicates.

Existing sample reports are left alone (the nightly sync may have moved them on), so this is
safe to run on every deploy.

Usage:
  uv run --with boto3 scripts/seed-demo.py <env> --owner <demo user sub>   create missing
  uv run --with boto3 scripts/seed-demo.py <env> --owner <sub> --reset     recreate all
  uv run --with boto3 scripts/seed-demo.py <env> --remove                  delete all
"""

import argparse
import os
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
from app.geo import geohash  # noqa: E402

DEMO_CONTACT = {"first_name": "Demo", "last_name": "Resident", "email": "demo@example.com"}
NEIGHBOR_CONTACT = {"first_name": "Sample", "last_name": "Neighbor", "email": "n@example.com"}
NEIGHBORS = [f"sample-neighbor-{n}" for n in range(1, 6)]

# Real City requests (data.nola.gov 2jgv-pqrq, fetched 2026-09-26).
TICKETS = {
    "2026-1316662": ("Closed", "2026-09-07T10:12:00", "2026-09-22T09:41:00"),
    "2026-1318483": ("Closed", "2026-09-12T19:46:55", "2026-09-22T09:50:10"),
    "2026-1322723": ("Pending", "2026-09-25T19:41:47", "2026-09-25T19:41:50"),
    "2026-1322474": ("Pending", "2026-09-25T09:20:00", "2026-09-25T09:20:04"),
    "2026-1322257": ("Pending", "2026-09-24T08:05:00", "2026-09-25T13:30:00"),
}

# (id, owner, type, reason, lat, lng, address, days_ago or ticket, supporters, description)
REPORTS = [
    # The demo account's own reports: one of each status.
    (
        "sample01",
        "demo",
        "Drainage",
        "Catch Basin Not Draining",
        29.946303,
        -90.131745,
        "8100 Freret St",
        "2026-1316662",
        3,
        "Water sits over the catch basin for a day after every rain. The grate is packed with "
        "leaves and mud.",
    ),
    (
        "sample02",
        "demo",
        "Roads and Streets",
        "Pothole",
        29.976096,
        -90.065061,
        "1700 Aubry St",
        "2026-1322723",
        2,
        "Deep pothole in the middle of the block, about two feet wide. Cars swerve into the "
        "other lane to miss it.",
    ),
    (
        "sample03",
        "demo",
        "Roads and Streets",
        "Sidewalk Damaged or Missing",
        29.988086,
        -90.110351,
        "5420 Canal Blvd",
        "2026-1322257",
        1,
        "Sidewalk slab lifted by a tree root, about four inches. Hard to get a stroller past.",
    ),
    (
        "sample04",
        "demo",
        "Drainage",
        "Drainage Manhole Cover Missing or Damaged",
        30.014231,
        -90.047382,
        "2754 Mithra St",
        "2026-1318483",
        0,
        "Manhole cover is cracked and rocks when cars drive over it.",
    ),
    (
        "sample05",
        "demo",
        "Drainage",
        "Catch Basin Not Draining",
        29.938695,
        -90.124773,
        "7101 Maple St",
        "2026-1322474",
        2,
        "Corner catch basin does not drain; the intersection floods after short storms.",
    ),
    (
        "sample06",
        "demo",
        "Drainage",
        "Street Flooding",
        29.97607,
        -90.07833,
        "N Broad St & Esplanade Ave",
        3,
        4,
        "Street floods curb to curb at this intersection in heavy rain and stays for hours.",
    ),
    # Other residents' reports, for the public map.
    (
        "sample07",
        "neighbor",
        "Roads and Streets",
        "Pothole",
        29.9208,
        -90.1016,
        "Magazine St & Napoleon Ave",
        5,
        6,
        "Pothole in the right lane just past the intersection, getting bigger every week.",
    ),
    (
        "sample08",
        "neighbor",
        "Drainage",
        "Catch Basin Clogged",
        29.96856,
        -90.05697,
        "Elysian Fields Ave & St Claude Ave",
        2,
        3,
        "Catch basin is covered with trash and beads from the last parade.",
    ),
    (
        "sample09",
        "neighbor",
        "Drainage",
        "Street Flooding",
        29.97465,
        -90.10059,
        "Canal St & N Carrollton Ave",
        1,
        5,
        "Standing water across two lanes after this morning's rain.",
    ),
    (
        "sample10",
        "neighbor",
        "Roads and Streets",
        "Street Subsidence (Sinking)",
        29.92816,
        -90.09147,
        "Louisiana Ave & St Charles Ave",
        9,
        2,
        "The pavement is sinking along the curb, leaving a dip that fills with water.",
    ),
    (
        "sample11",
        "neighbor",
        "Roads and Streets",
        "Pothole",
        29.91645,
        -90.1162,
        "Jefferson Ave & Tchoupitoulas St",
        12,
        1,
        "Several potholes in a row near the truck route.",
    ),
    (
        "sample12",
        "neighbor",
        "Drainage",
        "Catch Basin Clogged",
        29.98932,
        -90.07305,
        "Gentilly Blvd & Paris Ave",
        4,
        2,
        "Grass and dirt have filled the catch basin; water pools on the corner.",
    ),
    (
        "sample13",
        "neighbor",
        "Drainage",
        "Catch Basin Frame and Cover Missing or Damaged",
        29.97217,
        -90.09287,
        "Orleans Ave & N Jefferson Davis Pkwy",
        6,
        3,
        "Catch basin grate is broken with a gap big enough to catch a bike wheel.",
    ),
    (
        "sample14",
        "neighbor",
        "Roads and Streets",
        "Pothole",
        29.94945,
        -90.08643,
        "S Claiborne Ave & Earhart Blvd",
        8,
        4,
        "Large pothole under the overpass, hard to see at night.",
    ),
    (
        "sample15",
        "neighbor",
        "Roads and Streets",
        "Sidewalk Damaged or Missing",
        29.96351,
        -90.05777,
        "Chartres St & Frenchmen St",
        15,
        2,
        "Broken sidewalk bricks on the corner, a tripping hazard.",
    ),
    (
        "sample16",
        "neighbor",
        "Drainage",
        "Catch Basin Not Draining",
        29.94735,
        -90.12978,
        "S Carrollton Ave & Oak St",
        3,
        1,
        "Catch basin by the streetcar stop holds water long after rain stops.",
    ),
    (
        "sample17",
        "neighbor",
        "Drainage",
        "Street Flooding",
        30.00462,
        -90.10823,
        "Canal Blvd & Harrison Ave",
        2,
        2,
        "Neutral ground and both travel lanes flood during afternoon storms.",
    ),
    (
        "sample18",
        "neighbor",
        "Roads and Streets",
        "Pothole",
        30.00976,
        -90.02078,
        "Chef Menteur Hwy & Downman Rd",
        7,
        3,
        "Pothole in the left turn lane.",
    ),
    (
        "sample19",
        "neighbor",
        "Drainage",
        "Catch Basin Clogged",
        29.92083,
        -90.01454,
        "General de Gaulle Dr & Holiday Dr",
        10,
        1,
        "Catch basin opening is blocked by yard debris.",
    ),
    (
        "sample20",
        "neighbor",
        "Roads and Streets",
        "Street Subsidence (Sinking)",
        29.93521,
        -90.11126,
        "Freret St & Jefferson Ave",
        11,
        2,
        "Road surface has sunk around a utility cut.",
    ),
    (
        "sample21",
        "neighbor",
        "Drainage",
        "Catch Basin Not Draining",
        29.96558,
        -90.09371,
        "Banks St & S Salcedo St",
        5,
        3,
        "Water backs up out of the catch basin when it rains.",
    ),
    (
        "sample22",
        "neighbor",
        "Roads and Streets",
        "Pothole",
        29.96351,
        -90.03193,
        "Poland Ave & N Rampart St",
        13,
        0,
        "Pothole next to the railroad crossing.",
    ),
    (
        "sample23",
        "neighbor",
        "Drainage",
        "Street Flooding",
        29.95076,
        -90.10078,
        "S Broad St & Washington Ave",
        1,
        4,
        "Intersection floods quickly; cars stall in the water.",
    ),
    (
        "sample24",
        "neighbor",
        "Drainage",
        "Catch Basin Clogged",
        29.96629,
        -90.08445,
        "Bienville St & N Dorgenois St",
        6,
        1,
        "Catch basin is full of leaves and sand.",
    ),
]


def table_for(env: str):
    if env == "local":
        session = boto3.Session(
            aws_access_key_id="test",
            aws_secret_access_key="test",  # noqa: S106 (MiniStack dummy credentials)
            region_name="us-east-1",
        )
        return session.resource("dynamodb", endpoint_url="http://localhost:4566").Table(
            "rapport-local"
        )
    return boto3.resource("dynamodb", region_name="us-east-1").Table(f"rapport-{env}")


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat(timespec="seconds")


def city_iso(value: str) -> str:
    # City timestamps are local (CDT in these months) without a zone.
    return iso(datetime.fromisoformat(value).replace(tzinfo=UTC) + timedelta(hours=5))


def events_for(ticket: str | None, created: str) -> tuple[str, list[dict]]:
    """Status and timeline, following the same rules as the nightly City sync."""
    events = [{"status": "submitted", "event_source": "user", "created_at": created}]
    if not ticket:
        return "submitted", events
    status, city_created, city_modified = TICKETS[ticket]
    filed = city_iso(city_created)
    events.append({"status": "filed_with_311", "event_source": "user", "created_at": filed})
    modified = city_iso(city_modified)
    if status == "Closed":
        note = f"NOLA 311 closed request #{ticket}"
        events.append(
            {"status": "resolved", "event_source": "nola311", "note": note, "created_at": modified}
        )
        return "resolved", events
    working = datetime.fromisoformat(city_modified) - datetime.fromisoformat(city_created)
    if working > timedelta(hours=1):
        note = f"NOLA 311 is working on request #{ticket}"
        events.append(
            {
                "status": "in_progress",
                "event_source": "nola311",
                "note": note,
                "created_at": modified,
            }
        )
        return "in_progress", events
    return "filed_with_311", events


def items_for(report: tuple, owner: str, now: datetime) -> list[dict]:
    rid, who, rtype, reason, lat, lng, address, when, supporters, text = report
    ticket = when if isinstance(when, str) else None
    # Linked reports were filed on Rapport shortly before the City request.
    created = (
        iso(datetime.fromisoformat(city_iso(TICKETS[ticket][1])) - timedelta(minutes=20))
        if ticket
        else iso(now - timedelta(days=when, hours=int(rid[-2:]) % 7))
    )
    status, events = events_for(ticket, created)
    user_sub = owner if who == "demo" else NEIGHBORS[int(rid[-2:]) % len(NEIGHBORS)]
    meta = {
        "PK": f"REPORT#{rid}",
        "SK": "META",
        "GSI1PK": f"USER#{user_sub}",
        "GSI1SK": created,
        "GSI2PK": f"GEO#{geohash(lat, lng, 6)}",
        "GSI2SK": f"TYPE#{rtype}#{created}",
        "GSI3PK": "MAP",
        "GSI3SK": created,
        "id": rid,
        "source": "rapport",
        "sample": True,
        "user_sub": user_sub,
        "request_type": rtype,
        "request_reason": reason,
        "contact": DEMO_CONTACT if who == "demo" else NEIGHBOR_CONTACT,
        "location": {
            "lat": Decimal(str(lat)),
            "lng": Decimal(str(lng)),
            "source": "manual",
            "address": address,
        },
        "geohash": geohash(lat, lng, 9),
        "description_html": f"<p>{text}</p>",
        "photo_keys": [],
        "photo_public": False,
        "status": status,
        "supporter_count": supporters,
        "created_at": created,
        "updated_at": events[-1]["created_at"],
    }
    items = [meta]
    if ticket:
        meta["nola311_ticket"] = ticket
        meta["nola311_verified"] = True
        items.append({"PK": f"TICKET#{ticket}", "SK": f"REPORT#{rid}"})
    for n, event in enumerate(events):
        items.append({"PK": f"REPORT#{rid}", "SK": f"EVENT#{event['created_at']}#{n:02d}", **event})
    for sub in (f"sample-supporter-{n}" for n in range(1, supporters + 1)):
        items.append(
            {"PK": f"REPORT#{rid}", "SK": f"SUPPORT#{sub}", "user_sub": sub, "created_at": created}
        )
    return items


def remove(table, ids: list[str]) -> int:
    removed = 0
    with table.batch_writer() as batch:
        for rid in ids:
            items = table.query(KeyConditionExpression=Key("PK").eq(f"REPORT#{rid}"))["Items"]
            for item in items:
                if item["SK"] == "META" and item.get("nola311_ticket"):
                    batch.delete_item(
                        Key={"PK": f"TICKET#{item['nola311_ticket']}", "SK": f"REPORT#{rid}"}
                    )
                batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
            removed += bool(items)
    return removed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("env", choices=["prod", "local"])
    parser.add_argument("--owner", help="Cognito sub of the demo account")
    parser.add_argument("--reset", action="store_true", help="recreate existing samples")
    parser.add_argument("--remove", action="store_true", help="delete all samples")
    args = parser.parse_args()
    table = table_for(args.env)
    ids = [r[0] for r in REPORTS]

    if args.remove:
        print(f"removed {remove(table, ids)} sample reports")
        return
    if not args.owner:
        parser.error("--owner is required")
    if args.reset:
        remove(table, ids)

    now = datetime.now(UTC)
    created = 0
    for report in REPORTS:
        rid = report[0]
        if table.get_item(Key={"PK": f"REPORT#{rid}", "SK": "META"}).get("Item"):
            continue
        with table.batch_writer() as batch:
            for item in items_for(report, args.owner, now):
                batch.put_item(Item=item)
        created += 1

    # The demo account's profile, so the report form comes prefilled.
    profile_key = {"PK": f"USER#{args.owner}", "SK": "PROFILE"}
    if not table.get_item(Key=profile_key).get("Item"):
        stamp = iso(now)
        table.put_item(
            Item={
                **profile_key,
                **DEMO_CONTACT,
                "phone": "5045550100",
                "phone_type": "mobile",
                "neighborhood": "Freret",
                "created_at": stamp,
                "updated_at": stamp,
            }
        )
    print(f"created {created} sample reports ({len(REPORTS) - created} already present)")


if __name__ == "__main__":
    main()
