import ssl
from functools import lru_cache
from typing import Annotated

import certifi
import jwt
from fastapi import Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.config import Settings, get_settings


class CurrentUser(BaseModel):
    sub: str
    email: str | None = None


def _unauthorized(detail: str = "Sign in required") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _from_claims(claims: dict) -> CurrentUser:
    sub = claims.get("sub")
    if not sub:
        raise _unauthorized()
    return CurrentUser(sub=sub, email=claims.get("email"))


@lru_cache
def _jwks_client(issuer: str) -> jwt.PyJWKClient:
    # Use certifi's CA bundle: some Python builds (e.g. python.org on macOS)
    # ship without system certificates.
    ctx = ssl.create_default_context(cafile=certifi.where())
    return jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json", cache_keys=True, ssl_context=ctx)


def _verify_id_token(token: str, settings: Settings) -> dict:
    try:
        key = _jwks_client(settings.cognito_issuer).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            audience=settings.cognito_client_id,
            issuer=settings.cognito_issuer,
        )
    except jwt.PyJWTError as exc:
        raise _unauthorized("Invalid or expired token") from exc
    if claims.get("token_use") != "id":
        raise _unauthorized("ID token required")
    return claims


def get_current_user(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> CurrentUser:
    if settings.auth_mode == "apigw":
        event = request.scope.get("aws.event") or {}
        claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims")
        if not claims:
            raise _unauthorized()
        return _from_claims(claims)

    if settings.auth_mode == "jwt":
        header = request.headers.get("authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise _unauthorized()
        return _from_claims(_verify_id_token(token, settings))

    # dev: only ever enabled locally.
    if settings.environment not in ("local", "test"):
        raise _unauthorized()
    sub = request.headers.get("x-dev-user")
    if not sub:
        raise _unauthorized()
    return CurrentUser(sub=sub, email=request.headers.get("x-dev-email"))


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
