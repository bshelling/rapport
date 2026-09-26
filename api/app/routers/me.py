from fastapi import APIRouter

from app.auth import CurrentUserDep
from app.models.profile import Profile, ProfileUpdate
from app.services import profiles

router = APIRouter(tags=["profile"])


class ProfileOut(Profile):
    complete: bool


def _out(profile: Profile) -> ProfileOut:
    return ProfileOut(**profile.model_dump(), complete=profile.is_complete)


@router.get("/me")
def get_me(user: CurrentUserDep) -> ProfileOut:
    return _out(profiles.get_profile(user.sub, user.email))


@router.put("/me")
def put_me(update: ProfileUpdate, user: CurrentUserDep) -> ProfileOut:
    return _out(profiles.save_profile(user.sub, update))
