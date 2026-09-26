from fastapi import APIRouter, HTTPException, status

from app.auth import CurrentUserDep
from app.models.draft import Draft, DraftPatch, PhotoUpload, PhotoUploadRequest
from app.models.report import Report
from app.services import drafts, reports
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
def patch_draft(draft_id: str, patch: DraftPatch, user: CurrentUserDep) -> Draft:
    try:
        return drafts.update(draft_id, user.sub, patch)
    except drafts.DraftNotFound:
        raise _not_found() from None


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


@router.delete("/{draft_id}/photos/{photo_id}")
def delete_photo(draft_id: str, photo_id: str, user: CurrentUserDep) -> Draft:
    try:
        return drafts.remove_photo(draft_id, user.sub, photo_id)
    except drafts.DraftNotFound:
        raise _not_found() from None


@router.post("/{draft_id}/submit", status_code=status.HTTP_201_CREATED)
def submit_draft(draft_id: str, user: CurrentUserDep) -> Report:
    try:
        return reports.submit_draft(draft_id, user.sub)
    except drafts.DraftNotFound:
        raise _not_found() from None
    except reports.DraftIncomplete as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"message": "Draft is incomplete", "missing": exc.missing},
        ) from None
