from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from app.auth import CurrentUserDep
from app.models.draft import Draft, DraftPatch, PhotoUpload, PhotoUploadRequest
from app.models.report import Report
from app.services import drafts, reports
from app.services.dispatch import dispatch
from app.storage import MAX_PHOTO_BYTES

router = APIRouter(prefix="/drafts", tags=["drafts"])


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Draft not found")


@router.post("", status_code=status.HTTP_201_CREATED)
def create_draft(user: CurrentUserDep) -> Draft:
    return drafts.create(user.sub)


@router.get("/{draft_id}")
def get_draft(draft_id: str, user: CurrentUserDep) -> Draft:
    try:
        return drafts.get(draft_id, user.sub)
    except drafts.DraftNotFound:
        raise _not_found() from None


@router.patch("/{draft_id}")
def patch_draft(
    draft_id: str, patch: DraftPatch, user: CurrentUserDep, background: BackgroundTasks
) -> Draft:
    try:
        before = drafts.get(draft_id, user.sub, with_urls=False)
        draft = drafts.update(draft_id, user.sub, patch)
    except drafts.DraftNotFound:
        raise _not_found() from None
    # A new reason changes "does the photo match?"; re-run the cheap classifier only.
    if draft.request_reason != before.request_reason and draft.triage:
        dispatch("reclassify", draft_id, background)
    # A new spot or type means different neighbors: look for duplicates again.
    moved = draft.location and (
        before.location is None
        or (draft.location.lat, draft.location.lng) != (before.location.lat, before.location.lng)
    )
    if (
        draft.location
        and draft.request_type
        and (moved or draft.request_type != before.request_type)
    ):
        dispatch("duplicates", draft_id, background)
    return draft


@router.post("/{draft_id}/photos", status_code=status.HTTP_201_CREATED)
def add_photo(draft_id: str, body: PhotoUploadRequest, user: CurrentUserDep) -> PhotoUpload:
    try:
        photo, post = drafts.add_photo(draft_id, user.sub)
    except drafts.DraftNotFound:
        raise _not_found() from None
    except drafts.TooManyPhotos:
        raise HTTPException(status.HTTP_409_CONFLICT, "A report can have up to 3 photos") from None
    return PhotoUpload(
        photo=photo, upload_url=post["url"], fields=post["fields"], max_bytes=MAX_PHOTO_BYTES
    )


@router.post("/{draft_id}/photos/{photo_id}/uploaded", status_code=status.HTTP_202_ACCEPTED)
def photo_uploaded(
    draft_id: str, photo_id: str, user: CurrentUserDep, background: BackgroundTasks
) -> Draft:
    """Called after the browser's S3 upload; starts AI triage for the first photo."""
    try:
        is_first = drafts.confirm_upload(draft_id, user.sub, photo_id)
    except drafts.DraftNotFound:
        raise _not_found() from None
    if is_first:
        dispatch("triage", draft_id, background)
    return drafts.get(draft_id, user.sub)


@router.delete("/{draft_id}/photos/{photo_id}")
def delete_photo(
    draft_id: str, photo_id: str, user: CurrentUserDep, background: BackgroundTasks
) -> Draft:
    try:
        draft = drafts.remove_photo(draft_id, user.sub, photo_id)
    except drafts.DraftNotFound:
        raise _not_found() from None
    if draft.photos and draft.triage is None:
        dispatch("triage", draft_id, background)  # triage the new first photo
    return draft


@router.post("/{draft_id}/submit", status_code=status.HTTP_201_CREATED)
def submit_draft(draft_id: str, user: CurrentUserDep) -> Report:
    try:
        return reports.submit_draft(draft_id, user.sub)
    except drafts.DraftNotFound:
        raise _not_found() from None
    except reports.DraftIncomplete as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"message": "Draft is incomplete", "missing": exc.missing},
        ) from None
