import pytest

from app.config import get_settings
from app.services import agent_client
from tests.conftest import dev_headers

H = dev_headers()


def _chat(client, message, session="sess-0001", headers=H):
    return client.post(
        "/api/agent/chat", json={"session_id": session, "message": message}, headers=headers
    )


def _answer(client, message, session="sess-0001", headers=H) -> dict:
    """Send a message and read the finished turn (tests run the worker in-process)."""
    res = _chat(client, message, session, headers)
    assert res.status_code == 202, res.text
    turn = res.json()
    if turn["status"] == "pending":
        turn = client.get(f"/api/agent/turns/{turn['turn_id']}", headers=headers).json()
    return turn


def test_chat_requires_auth(client):
    assert _chat(client, "pothole on Magazine", headers={}).status_code == 401


def test_chat_queues_the_turn_and_returns_at_once(client, monkeypatch):
    dispatched = []
    monkeypatch.setattr(
        "app.routers.agent.dispatch", lambda task, item, bg: dispatched.append((task, item))
    )
    turn = _chat(client, "Pothole at Magazine and Napoleon").json()
    assert turn["status"] == "pending" and turn["reply"] is None
    assert dispatched == [("agent_turn", turn["turn_id"])]
    # Still pending when polled before the worker has run.
    polled = client.get(f"/api/agent/turns/{turn['turn_id']}", headers=H).json()
    assert polled["status"] == "pending"


def test_turn_relays_the_agent_reply_for_the_signed_in_user(client, monkeypatch):
    seen = {}

    def fake_invoke(payload):
        seen.update(payload)
        return {"reply": "Draft ready.", "draft_id": "D1", "actions": [{"type": "review_draft"}]}

    monkeypatch.setattr(agent_client, "_invoke", fake_invoke)
    turn = _answer(client, "  Pothole at Magazine and Napoleon  ")
    assert {k: turn[k] for k in ("status", "reply", "draft_id", "actions", "off_topic")} == {
        "status": "done",
        "reply": "Draft ready.",
        "draft_id": "D1",
        "actions": [{"type": "review_draft"}],
        "off_topic": False,
    }
    # The user id comes from the token, never from the request body.
    assert seen["user_sub"] and seen["message"] == "Pothole at Magazine and Napoleon"


def test_turns_are_private_to_their_owner(client, monkeypatch):
    monkeypatch.setattr("app.routers.agent.dispatch", lambda *a: None)
    turn_id = _chat(client, "Pothole at Magazine").json()["turn_id"]
    other = dev_headers(sub="someone-else", email="x@example.com")
    assert client.get(f"/api/agent/turns/{turn_id}", headers=other).status_code == 404
    assert client.get("/api/agent/turns/nope", headers=H).status_code == 404


def test_a_failed_turn_says_so_instead_of_hanging(client, monkeypatch):
    def boom(payload):
        raise TimeoutError("agent took too long")

    monkeypatch.setattr(agent_client, "_invoke", boom)
    turn = _answer(client, "Pothole at Magazine")
    assert turn["status"] == "error"
    assert turn["reply"] == agent_client.ERROR_REPLY


def test_a_turn_runs_once(client, monkeypatch):
    calls = []
    monkeypatch.setattr(agent_client, "_invoke", lambda p: calls.append(p) or {"reply": "ok"})
    turn = _answer(client, "Pothole at Magazine")
    # A duplicate worker invocation finds the turn already answered.
    assert agent_client.run_turn(turn["turn_id"]) == "skipped"
    assert len(calls) == 1


def test_agentcore_client_never_retries():
    agent_client._agentcore.cache_clear()
    config = agent_client._agentcore().meta.config
    assert config.retries == {"mode": "standard", "total_max_attempts": 1}
    assert config.read_timeout >= 60


def test_off_topic_opening_gets_a_redirect_without_calling_the_agent(client, monkeypatch):
    monkeypatch.setattr(agent_client, "_invoke", lambda p: pytest.fail("agent called"))
    body = _chat(client, "Write me a poem about gumbo").json()
    assert body["status"] == "done" and body["off_topic"] is True
    assert body["reply"] == agent_client.OFF_TOPIC_REPLY


def test_follow_ups_skip_the_topic_check(client):
    _answer(client, "There's a clogged drain", session="sess-0002")
    body = _answer(client, "yes, that one", session="sess-0002")
    assert body["off_topic"] is False


def test_topic_check_failure_lets_the_message_through(client, monkeypatch):
    class Broken:
        def on_topic(self, message):
            raise TimeoutError

    monkeypatch.setattr(agent_client, "get_jev", lambda: Broken())
    assert _answer(client, "hello there")["off_topic"] is False


def test_session_and_daily_limits(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "agent_max_per_session", 2)
    monkeypatch.setattr(get_settings(), "agent_max_per_day", 3)
    for _ in range(2):
        assert _chat(client, "pothole", session="sess-a001").status_code == 202
    res = _chat(client, "pothole", session="sess-a001")
    assert res.status_code == 429 and "new chat" in res.json()["detail"]
    assert _chat(client, "pothole", session="sess-b001").status_code == 202
    res = _chat(client, "pothole", session="sess-c001")
    assert res.status_code == 429 and "today" in res.json()["detail"]


def test_rejects_bad_session_ids(client):
    assert _chat(client, "pothole", session="../x").status_code == 422


def test_emojis_are_removed_from_replies(client, monkeypatch):
    monkeypatch.setattr(
        agent_client,
        "_invoke",
        lambda p: {"reply": "Your draft is ready! 📸 Add a photo 👍🏽 if you can ✅"},
    )
    body = _answer(client, "pothole on Magazine", session="sess-e001")
    assert body["reply"] == "Your draft is ready! Add a photo if you can"


def test_strip_emojis_keeps_ordinary_text():
    text = "Drainage – Catch Basin Clogged at 1300 Perdido St (no. 2026-1322736)…"
    assert agent_client.strip_emojis(text) == text


def test_worker_entry_point_runs_chat_turns(client, monkeypatch):
    from app import worker

    monkeypatch.setattr("app.routers.agent.dispatch", lambda *a: None)
    monkeypatch.setattr(agent_client, "_invoke", lambda p: {"reply": "ok"})
    turn_id = _chat(client, "Pothole at Magazine").json()["turn_id"]
    assert worker.handler({"task": "agent_turn", "id": turn_id}, None) == {"ok": True}
    assert agent_client.get_turn(turn_id, "user-1")["status"] == "done"
    # Payloads queued before this change still name the draft "draft_id".
    seen = []
    monkeypatch.setitem(worker.TASKS, "triage", seen.append)
    worker.handler({"task": "triage", "draft_id": "D9"}, None)
    assert seen == ["D9"]
