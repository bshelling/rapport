import pytest
from pydantic import ValidationError

from app.models.draft import DraftPatch
from app.services import drafts, profiles, reports
from rapport_agent.core import ChatTurn, turn_text
from rapport_agent.tools import TurnActions, build_tools


def tools_for(user_sub):
    actions = TurnActions()
    return {t.tool_name: t for t in build_tools(user_sub, actions)}, actions


def test_tool_set():
    tools, _ = tools_for("u1")
    assert set(tools) == {
        "get_service_catalog",
        "suggest_category",
        "find_address",
        "find_nearby_reports",
        "create_report_draft",
        "list_my_reports",
        "get_report_status",
        "explain_next_steps",
    }


def test_catalog_and_category(table):
    tools, _ = tools_for("u1")
    catalog = tools["get_service_catalog"]()
    assert {"request_type": "Drainage"}.items() <= catalog[1].items()
    suggestion = tools["suggest_category"](description="leaves blocking the drain")
    assert suggestion["request_reason"] == "Catch Basin Clogged"
    assert suggestion["request_type"] == "Drainage"


def test_find_address(table):
    tools, _ = tools_for("u1")
    assert tools["find_address"](query="Magazine Napoleon")["found"] is True
    assert tools["find_address"](query="Atlantis")["found"] is False


def test_create_report_draft_prefills_contact_and_is_owned(table):
    profiles.save_profile(
        "u1",
        profiles.ProfileUpdate(first_name="Alex", last_name="R", email="alex@example.com"),
    )
    tools, actions = tools_for("u1")
    res = tools["create_report_draft"](
        request_type="Roads and Streets",
        request_reason="Pothole",
        lat=29.9208,
        lng=-90.1016,
        address="Magazine St & Napoleon Ave",
        description="Deep pothole in the right lane.",
    )
    assert res["ok"] is True and res["contact_prefilled"] is True
    assert actions.draft_id == res["draft_id"]
    assert actions.items == [{"type": "review_draft", "draft_id": res["draft_id"]}]
    draft = drafts.get(res["draft_id"], "u1", with_urls=False)
    assert draft.step == 3 and draft.contact.last_name == "R"
    assert draft.location.address == "Magazine St & Napoleon Ave"
    with pytest.raises(drafts.DraftNotFound):
        drafts.get(res["draft_id"], "someone-else")


@pytest.mark.parametrize(
    "overrides,error",
    [
        ({"request_reason": "Street Flooding"}, "doesn't belong"),
        ({"lat": 30.45, "lng": -91.18}, "isn't in New Orleans"),
    ],
)
def test_create_report_draft_validates(table, overrides, error):
    tools, actions = tools_for("u1")
    args = {
        "request_type": "Roads and Streets",
        "request_reason": "Pothole",
        "lat": 29.9208,
        "lng": -90.1016,
        "address": "x",
        "description": "y",
        **overrides,
    }
    res = tools["create_report_draft"](**args)
    assert res["ok"] is False and error in res["error"] and actions.draft_id is None


def _submit(user_sub):
    draft = drafts.create(user_sub)
    drafts.update(
        draft.id,
        user_sub,
        DraftPatch.model_validate(
            {
                "request_type": "Drainage",
                "request_reason": "Catch Basin Clogged",
                "contact": {"first_name": "A", "last_name": "B", "email": "a@example.com"},
                "location": {"lat": 29.9212, "lng": -90.1027},
                "description_html": "<p>Leaves everywhere in the drain.</p>",
            }
        ),
    )
    return reports.submit_draft(draft.id, user_sub)


def test_reports_tools_only_see_the_residents_own(table):
    mine = _submit("u1")
    theirs = _submit("u2")
    tools, _ = tools_for("u1")
    listed = tools["list_my_reports"]()
    assert [r["report_id"] for r in listed] == [mine.id]
    status = tools["get_report_status"](report_id=mine.id)
    assert status["found"] is True and status["timeline"][0]["status"] == "submitted"
    assert tools["get_report_status"](report_id=theirs.id) == {"found": False}
    nearby = tools["find_nearby_reports"](request_type="Drainage", lat=29.9212, lng=-90.1027)
    assert {n["yours"] for n in nearby} == {True, False}


def test_turn_text_and_payload_validation():
    msgs = [
        {"role": "user", "content": [{"text": "hi"}]},
        {"role": "assistant", "content": [{"text": "First."}, {"toolUse": {}}]},
        {"role": "assistant", "content": [{"text": "Second."}]},
    ]
    assert turn_text(msgs) == "First.\n\nSecond."
    with pytest.raises(ValidationError):
        ChatTurn.model_validate({"user_sub": "", "session_id": "short", "message": ""})
