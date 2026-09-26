import boto3
import pytest

from app.config import get_settings
from app.models.insights import Observation
from app.services import dispatch, jev, triage, vision
from tests.conftest import BUCKET, dev_headers
from tests.helpers import CONTACT, DESCRIPTION, LOCATION

ME = dev_headers("user-1", "user-1@example.com")
OTHER = dev_headers("user-2", "user-2@example.com")


def _clear_caches():
    for fn in (vision.get_vision, jev.get_jev, dispatch._lambda):
        if hasattr(fn, "cache_clear"):  # may be monkeypatched
            fn.cache_clear()


@pytest.fixture(autouse=True)
def fake_ai():
    _clear_caches()
    yield
    _clear_caches()


def _draft(client, reason=None):
    draft_id = client.post("/api/drafts", headers=ME).json()["id"]
    if reason:
        client.patch(
            f"/api/drafts/{draft_id}",
            json={"request_type": "Drainage", "request_reason": reason},
            headers=ME,
        )
    return draft_id


def _upload(client, draft_id):
    photo = client.post(f"/api/drafts/{draft_id}/photos", json={}, headers=ME).json()["photo"]
    boto3.client("s3").put_object(Bucket=BUCKET, Key=photo["key"], Body=b"\xff\xd8" + b"0" * 2048)
    res = client.post(f"/api/drafts/{draft_id}/photos/{photo['id']}/uploaded", headers=ME)
    assert res.status_code == 202, res.text
    return photo


def _get(client, draft_id, headers=ME):
    return client.get(f"/api/drafts/{draft_id}", headers=headers).json()


def test_upload_confirmation_runs_triage(client):
    draft_id = _draft(client, "Catch Basin Clogged")
    photo = _upload(client, draft_id)
    t = _get(client, draft_id)["triage"]  # TestClient runs background tasks before returning
    assert t["status"] == "done" and t["photo_id"] == photo["id"]
    assert t["suggested"] == {
        "request_type": "Drainage",
        "request_reason": "Catch Basin Clogged",
        "probability": 0.91,
    }
    assert t["severity"]["label"] == "Serious"
    assert t["matches_selection"] == 0.95
    assert "leaves" in t["observation"]["scene_description"]


def test_upload_confirmation_requires_the_object(client):
    draft_id = _draft(client)
    photo = client.post(f"/api/drafts/{draft_id}/photos", json={}, headers=ME).json()["photo"]
    res = client.post(f"/api/drafts/{draft_id}/photos/{photo['id']}/uploaded", headers=ME)
    assert res.status_code == 404
    other = client.post(f"/api/drafts/{draft_id}/photos/{photo['id']}/uploaded", headers=OTHER)
    assert other.status_code == 404


def test_only_the_first_photo_is_triaged_once(client, monkeypatch):
    calls = []
    real = vision.FakeVision.observe
    monkeypatch.setattr(
        vision.FakeVision, "observe", lambda self, b: calls.append(1) or real(self, b)
    )
    draft_id = _draft(client)
    _upload(client, draft_id)
    _upload(client, draft_id)
    triage.run(draft_id)  # re-running for the same photo is a no-op
    assert len(calls) == 1


def test_changing_reason_reclassifies_without_new_vision_call(client, monkeypatch):
    draft_id = _draft(client, "Catch Basin Clogged")
    _upload(client, draft_id)
    monkeypatch.setattr(vision.FakeVision, "observe", lambda self, b: pytest.fail("vision re-run"))
    client.patch(
        f"/api/drafts/{draft_id}",
        json={"request_type": "Drainage", "request_reason": "Street Flooding"},
        headers=ME,
    )
    assert _get(client, draft_id)["triage"]["matches_selection"] == 0.1


def test_removing_the_triaged_photo_triages_the_next(client):
    draft_id = _draft(client)
    first = _upload(client, draft_id)
    second = _upload(client, draft_id)
    client.delete(f"/api/drafts/{draft_id}/photos/{first['id']}", headers=ME)
    assert _get(client, draft_id)["triage"]["photo_id"] == second["id"]


def test_vision_failure_is_recorded_and_submit_still_works(client, monkeypatch):
    def boom(self, jpeg):
        raise vision.VisionError("nope")

    monkeypatch.setattr(vision.FakeVision, "observe", boom)
    draft_id = _draft(client, "Catch Basin Clogged")
    _upload(client, draft_id)
    t = _get(client, draft_id)["triage"]
    assert t["status"] == "error" and t["error"] == "VisionError"
    for body in ({"contact": CONTACT}, {"location": LOCATION, "description_html": DESCRIPTION}):
        client.patch(f"/api/drafts/{draft_id}", json=body, headers=ME)
    res = client.post(f"/api/drafts/{draft_id}/submit", headers=ME)
    assert res.status_code == 201
    detail = client.get(f"/api/reports/{res.json()['id']}", headers=OTHER).json()
    assert detail["ai"] is None and detail["photos"] == []  # unscreened: owner-only


def _submit(client, draft_id):
    for body in ({"contact": CONTACT}, {"location": LOCATION, "description_html": DESCRIPTION}):
        client.patch(f"/api/drafts/{draft_id}", json=body, headers=ME)
    return client.post(f"/api/drafts/{draft_id}/submit", headers=ME).json()["id"]


def test_screened_photos_are_public_with_ai_assessment(client):
    draft_id = _draft(client, "Catch Basin Clogged")
    _upload(client, draft_id)
    report_id = _submit(client, draft_id)
    detail = client.get(f"/api/reports/{report_id}", headers=OTHER).json()
    assert detail["photo_public"] is True and len(detail["photos"]) == 1
    assert detail["ai"]["severity_label"] == "Serious"
    assert detail["ai"]["suggested_reason"] == "Catch Basin Clogged"
    assert detail["contact"] is None


def test_person_or_plate_keeps_photos_private(client, monkeypatch):
    real = vision.FakeVision.observe

    def with_person(self, jpeg):
        return real(self, jpeg).model_copy(update={"contains_person_or_plate": True})

    monkeypatch.setattr(vision.FakeVision, "observe", with_person)
    draft_id = _draft(client, "Catch Basin Clogged")
    _upload(client, draft_id)
    assert _get(client, draft_id)["photos_private"] is True
    report_id = _submit(client, draft_id)
    assert client.get(f"/api/reports/{report_id}", headers=OTHER).json()["photos"] == []
    assert len(client.get(f"/api/reports/{report_id}", headers=ME).json()["photos"]) == 1


def test_lambda_mode_invokes_the_worker_asynchronously(client, monkeypatch):
    monkeypatch.setenv("RAPPORT_WORKER_MODE", "lambda")
    monkeypatch.setenv("RAPPORT_WORKER_FUNCTION", "rapport-worker-test")
    get_settings.cache_clear()
    sent = []

    class FakeLambda:
        def invoke(self, **kwargs):
            sent.append(kwargs)

    monkeypatch.setattr(dispatch, "_lambda", lambda: FakeLambda())
    draft_id = _draft(client)
    _upload(client, draft_id)
    assert len(sent) == 1
    assert sent[0]["FunctionName"] == "rapport-worker-test"
    assert sent[0]["InvocationType"] == "Event"
    assert b'"task": "triage"' in sent[0]["Payload"]


# --- Parsing the real clients' responses -------------------------------------


class _Block:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class _Response:
    def __init__(self, content, stop_reason="tool_use"):
        self.content = content
        self.stop_reason = stop_reason


GOOD_INPUT = {
    "scene_description": "A deep pothole in the right lane.",
    "visible_objects": ["pothole"],
    "landmarks": ["Magazine St"],
    "image_quality": "good",
    "contains_person_or_plate": False,
    "suggested_description": "There is a deep pothole in the right lane.",
}


def _bedrock(response):
    v = vision.BedrockVision.__new__(vision.BedrockVision)
    v.model = "anthropic.claude-opus-5"
    v.client = _Block(messages=_Block(create=lambda **kw: response))
    return v


def test_bedrock_vision_parses_tool_call():
    resp = _Response(
        [
            _Block(type="thinking"),
            _Block(type="tool_use", name="record_observation", input=GOOD_INPUT),
        ]
    )
    obs = _bedrock(resp).observe(b"jpeg")
    assert obs.landmarks == ["Magazine St"]


@pytest.mark.parametrize(
    "resp",
    [
        _Response([], stop_reason="refusal"),
        _Response([_Block(type="text", text="A pothole.")], stop_reason="end_turn"),
        _Response([_Block(type="tool_use", name="record_observation", input={"x": 1})]),
    ],
)
def test_bedrock_vision_rejects_bad_responses(resp):
    with pytest.raises(vision.VisionError):
        _bedrock(resp).observe(b"jpeg")


def test_typesafe_mapping(monkeypatch):
    from typesafe_sdk import SystemOneResponse

    fake = SystemOneResponse.model_validate(
        {
            "model": "jev",
            "usage": {"input_tokens": 10, "output_tokens": 5},
            "answers": {
                "request_reason": {
                    "type": "choice",
                    "choice": "Pothole",
                    "confidence": 0.88,
                    "probabilities": {"Pothole": 0.88, "Street Subsidence (Sinking)": 0.1},
                },
                "severity": {
                    "type": "score",
                    "score": 2.6,
                    "confidence": 0.7,
                    "legend": {},
                    "probabilities": {},
                },
                "is_actionable": {"type": "noul", "noul": 0.99},
                "safety_hazard": {"type": "noul", "noul": 0.6},
                "matches_selection": {"type": "noul", "noul": 0.2},
            },
        }
    )
    j = jev.TypeSafeJev.__new__(jev.TypeSafeJev)
    j.client = _Block(system_one=lambda state, questions: fake)
    obs = Observation.model_validate(GOOD_INPUT)
    r = j.classify(obs, "Street Flooding", None)
    assert r.suggested.request_type == "Roads and Streets"
    assert r.alternatives[0].request_reason == "Street Subsidence (Sinking)"
    assert (r.severity.level, r.severity.label) == (4, "Hazardous")  # 0-based 2.6 -> level 4
    assert r.matches_selection == 0.2


def test_client_is_chosen_by_model_id():
    from anthropic import AnthropicBedrock, AnthropicBedrockMantle

    assert isinstance(
        vision.BedrockVision("anthropic.claude-opus-5", "us-east-1").client, AnthropicBedrockMantle
    )
    assert isinstance(
        vision.BedrockVision("us.anthropic.claude-opus-4-6-v1", "us-east-1").client,
        AnthropicBedrock,
    )


def test_live_jev_uses_the_configured_model(monkeypatch):
    seen = {}

    class Capture:
        def __init__(self, **kwargs):
            seen.update(kwargs)

    monkeypatch.setattr(jev, "TypeSafeClient", Capture)
    monkeypatch.setattr(jev, "_api_key", lambda: "test-key")
    monkeypatch.setenv("RAPPORT_AI_MODE", "live")
    get_settings.cache_clear()
    jev.get_jev.cache_clear()
    jev.get_jev()
    # "jev" alone is rejected by the API ("Unknown model: jev").
    assert seen["model"] == "jev-latest" and seen["api_key"] == "test-key"
