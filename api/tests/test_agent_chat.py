import pytest

from app.config import get_settings
from app.services import agent_client
from tests.conftest import dev_headers

H = dev_headers()


def _chat(client, message, session="sess-0001", headers=H):
    return client.post(
        "/api/agent/chat", json={"session_id": session, "message": message}, headers=headers
    )


def test_chat_requires_auth(client):
    assert _chat(client, "pothole on Magazine", headers={}).status_code == 401


def test_chat_relays_the_agent_reply_for_the_signed_in_user(client, monkeypatch):
    seen = {}

    def fake_invoke(payload):
        seen.update(payload)
        return {"reply": "Draft ready.", "draft_id": "D1", "actions": [{"type": "review_draft"}]}

    monkeypatch.setattr(agent_client, "_invoke", fake_invoke)
    res = _chat(client, "  Pothole at Magazine and Napoleon  ")
    assert res.status_code == 200
    assert res.json() == {
        "reply": "Draft ready.",
        "draft_id": "D1",
        "actions": [{"type": "review_draft"}],
        "off_topic": False,
    }
    # The user id comes from the token, never from the request body.
    assert seen["user_sub"] and seen["message"] == "Pothole at Magazine and Napoleon"


def test_off_topic_opening_gets_a_redirect_without_calling_the_agent(client, monkeypatch):
    monkeypatch.setattr(agent_client, "_invoke", lambda p: pytest.fail("agent called"))
    body = _chat(client, "Write me a poem about gumbo").json()
    assert body["off_topic"] is True
    assert body["reply"] == agent_client.OFF_TOPIC_REPLY


def test_follow_ups_skip_the_topic_check(client):
    _chat(client, "There's a clogged drain", session="sess-0002")
    body = _chat(client, "yes, that one", session="sess-0002").json()
    assert body["off_topic"] is False


def test_topic_check_failure_lets_the_message_through(client, monkeypatch):
    class Broken:
        def on_topic(self, message):
            raise TimeoutError

    monkeypatch.setattr(agent_client, "get_jev", lambda: Broken())
    assert _chat(client, "hello there").json()["off_topic"] is False


def test_session_and_daily_limits(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "agent_max_per_session", 2)
    monkeypatch.setattr(get_settings(), "agent_max_per_day", 3)
    for _ in range(2):
        assert _chat(client, "pothole", session="sess-a001").status_code == 200
    res = _chat(client, "pothole", session="sess-a001")
    assert res.status_code == 429 and "new chat" in res.json()["detail"]
    assert _chat(client, "pothole", session="sess-b001").status_code == 200
    res = _chat(client, "pothole", session="sess-c001")
    assert res.status_code == 429 and "today" in res.json()["detail"]


def test_rejects_bad_session_ids(client):
    assert _chat(client, "pothole", session="../x").status_code == 422
