from tests.conftest import dev_headers

VALID = {
    "first_name": "  Alex ",
    "last_name": "Robichaux",
    "email": "alex@example.com",
    "phone": "(504) 555-0100",
    "phone_type": "mobile",
    "neighborhood": "Uptown",
}


def test_me_requires_sign_in(client):
    assert client.get("/api/me").status_code == 401
    assert client.put("/api/me", json=VALID).status_code == 401


def test_new_user_gets_incomplete_default_from_token(client):
    res = client.get("/api/me", headers=dev_headers())
    assert res.status_code == 200
    body = res.json()
    assert body["sub"] == "user-1"
    assert body["email"] == "alex@example.com"
    assert body["complete"] is False
    assert body["created_at"] is None


def test_save_profile_normalizes_and_persists(client, table):
    res = client.put("/api/me", json=VALID, headers=dev_headers())
    assert res.status_code == 200, res.text
    saved = res.json()
    assert saved["first_name"] == "Alex"
    assert saved["phone"] == "5045550100"
    assert saved["complete"] is True
    assert saved["created_at"] == saved["updated_at"]

    item = table.get_item(Key={"PK": "USER#user-1", "SK": "PROFILE"})["Item"]
    assert item["neighborhood"] == "Uptown"

    again = client.get("/api/me", headers=dev_headers()).json()
    assert again == saved


def test_update_keeps_created_at_and_clears_optional_fields(client, table):
    first = client.put("/api/me", json=VALID, headers=dev_headers()).json()
    cleared = {**VALID, "phone": None, "phone_type": None, "neighborhood": ""}
    second = client.put("/api/me", json=cleared, headers=dev_headers()).json()
    assert second["created_at"] == first["created_at"]
    assert second["phone"] is None and second["neighborhood"] is None
    item = table.get_item(Key={"PK": "USER#user-1", "SK": "PROFILE"})["Item"]
    assert "phone" not in item and "neighborhood" not in item


def test_profiles_are_isolated_per_user(client):
    client.put("/api/me", json=VALID, headers=dev_headers("user-1"))
    other = client.get("/api/me", headers=dev_headers("user-2", "b@example.com")).json()
    assert other["first_name"] == "" and other["email"] == "b@example.com"


def test_validation_errors(client):
    bad = [
        {**VALID, "phone": "555-0100"},
        {**VALID, "neighborhood": "Atlantis"},
        {**VALID, "first_name": "   "},
        {**VALID, "email": "not-an-email"},
        {**VALID, "phone_type": "fax"},
    ]
    for body in bad:
        res = client.put("/api/me", json=body, headers=dev_headers())
        assert res.status_code == 422, body


def test_neighborhoods_are_public(client):
    res = client.get("/api/neighborhoods")
    assert res.status_code == 200
    names = res.json()["neighborhoods"]
    assert len(names) == 72
    assert "Bayou St. John" in names and "St. Anthony" in names
