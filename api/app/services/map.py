from boto3.dynamodb.conditions import Key

from app.db import get_table
from app.models.map import MapReport, MapReports

MAX_PINS = 1000
# ~11 m: enough to find the pothole, not enough to pinpoint a doorstep.
COORD_DECIMALS = 4

BBox = tuple[float, float, float, float]  # west, south, east, north


def _in_bbox(lat: float, lng: float, bbox: BBox | None) -> bool:
    if bbox is None:
        return True
    west, south, east, north = bbox
    return west <= lng <= east and south <= lat <= north


def public_reports(bbox: BBox | None = None) -> MapReports:
    table = get_table()
    kwargs: dict = {
        "IndexName": "GSI3",
        "KeyConditionExpression": Key("GSI3PK").eq("MAP"),
        "ScanIndexForward": False,
    }
    pins: list[MapReport] = []
    truncated = False
    while True:
        res = table.query(**kwargs)
        for item in res["Items"]:
            loc = item["location"]
            lat, lng = float(loc["lat"]), float(loc["lng"])
            if item.get("status") == "closed_duplicate" or not _in_bbox(lat, lng, bbox):
                continue
            pins.append(
                MapReport(
                    id=item["id"],
                    request_type=item["request_type"],
                    request_reason=item["request_reason"],
                    status=item["status"],
                    lat=round(lat, COORD_DECIMALS),
                    lng=round(lng, COORD_DECIMALS),
                    supporter_count=int(item.get("supporter_count", 0)),
                    created_at=item["created_at"],
                )
            )
            if len(pins) >= MAX_PINS:
                return MapReports(reports=pins, truncated=True)
        if "LastEvaluatedKey" not in res:
            break
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]
    return MapReports(reports=pins, truncated=truncated)
