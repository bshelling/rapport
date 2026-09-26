from fastapi import APIRouter, HTTPException, status

from app.models.map import MapReports
from app.services import map as map_service

router = APIRouter(prefix="/map", tags=["map"])


def _parse_bbox(bbox: str | None) -> map_service.BBox | None:
    if not bbox:
        return None
    try:
        west, south, east, north = (float(v) for v in bbox.split(","))
    except ValueError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "bbox must be west,south,east,north"
        ) from None
    if not (west < east and south < north):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "bbox is inverted")
    return west, south, east, north


@router.get("/reports")
def map_reports(bbox: str | None = None) -> MapReports:
    """Public, anonymous feed of reports for the live map."""
    return map_service.public_reports(_parse_bbox(bbox))
