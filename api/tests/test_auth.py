import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app import auth
from app.main import handler

ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST"
CLIENT_ID = "client-123"


def _http_event(path: str, claims: dict | None = None) -> dict:
    ctx = {"http": {"method": "GET", "path": path, "sourceIp": "1.2.3.4"}, "stage": "$default"}
    if claims is not None:
        ctx["authorizer"] = {"jwt": {"claims": claims, "scopes": None}}
    return {
        "version": "2.0",
        "routeKey": "ANY /api/{proxy+}",
        "rawPath": path,
        "rawQueryString": "",
        "headers": {"host": "example.cloudfront.net"},
        "requestContext": ctx,
        "isBase64Encoded": False,
    }


def test_apigw_mode_uses_authorizer_claims(monkeypatch, table):
    monkeypatch.setenv("RAPPORT_AUTH_MODE", "apigw")
    auth.get_settings.cache_clear()
    res = handler(_http_event("/api/me", {"sub": "abc", "email": "a@example.com"}), None)
    assert res["statusCode"] == 200
    assert '"sub":"abc"' in res["body"]


def test_apigw_mode_without_claims_is_401(monkeypatch, table):
    monkeypatch.setenv("RAPPORT_AUTH_MODE", "apigw")
    auth.get_settings.cache_clear()
    assert handler(_http_event("/api/me"), None)["statusCode"] == 401


def test_dev_mode_is_refused_outside_local(monkeypatch, client):
    monkeypatch.setenv("RAPPORT_ENVIRONMENT", "prod")
    auth.get_settings.cache_clear()
    assert client.get("/api/me", headers={"X-Dev-User": "x"}).status_code == 401


class _Key:
    def __init__(self, key):
        self.key = key


class _FakeJwks:
    def __init__(self, public_key):
        self.public_key = public_key

    def get_signing_key_from_jwt(self, token):
        return _Key(self.public_key)


@pytest.fixture
def jwt_mode(monkeypatch):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setenv("RAPPORT_AUTH_MODE", "jwt")
    monkeypatch.setenv("RAPPORT_COGNITO_ISSUER", ISSUER)
    monkeypatch.setenv("RAPPORT_COGNITO_CLIENT_ID", CLIENT_ID)
    auth.get_settings.cache_clear()
    monkeypatch.setattr(auth, "_jwks_client", lambda issuer: _FakeJwks(private.public_key()))

    def make(**overrides):
        now = int(time.time())
        claims = {
            "sub": "jwt-user",
            "email": "j@example.com",
            "aud": CLIENT_ID,
            "iss": ISSUER,
            "token_use": "id",
            "iat": now,
            "exp": now + 300,
            **overrides,
        }
        return jwt.encode(claims, private, algorithm="RS256")

    return make


def _get_me(client, token):
    return client.get("/api/me", headers={"Authorization": f"Bearer {token}"})


def test_jwt_mode_accepts_valid_id_token(client, jwt_mode):
    res = _get_me(client, jwt_mode())
    assert res.status_code == 200
    assert res.json()["sub"] == "jwt-user"


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "someone-else"},
        {"iss": "https://evil.example.com"},
        {"exp": 1},
        {"token_use": "access"},
    ],
)
def test_jwt_mode_rejects_bad_tokens(client, jwt_mode, overrides):
    assert _get_me(client, jwt_mode(**overrides)).status_code == 401


def test_jwt_mode_requires_bearer_header(client, jwt_mode):
    assert client.get("/api/me").status_code == 401
