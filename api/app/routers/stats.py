import logging

from fastapi import APIRouter, HTTPException, status

from app.services import stats as stats_service

router = APIRouter(tags=["meta"])
log = logging.getLogger(__name__)


@router.get("/stats")
def get_stats() -> dict:
    """Public impact numbers. City numbers are recomputed nightly after the NOLA 311
    import; Rapport's own counts are live, so a new report shows up right away."""
    data = stats_service.latest()
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stats haven't been computed yet")
    try:
        data["rapport"] = stats_service.rapport_numbers()
    except Exception:  # noqa: BLE001 - the nightly copy is still a fine answer
        log.warning("live Rapport numbers failed; serving last night's", exc_info=True)
    return data
