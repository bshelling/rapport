from fastapi import APIRouter, HTTPException, status

from app.services import stats as stats_service

router = APIRouter(tags=["meta"])


@router.get("/stats")
def get_stats() -> dict:
    """Public impact numbers (recomputed nightly after the NOLA 311 import)."""
    data = stats_service.latest()
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stats haven't been computed yet")
    return data
