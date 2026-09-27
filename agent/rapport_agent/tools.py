"""Tools for the Rapport agent. Every tool is bound to the verified resident (user_sub) that
the API passed in; the model can't choose whose data it touches."""

from dataclasses import dataclass, field

from strands import tool

from app.catalog import SERVICE_CATALOG, is_valid_pair
from app.geo import in_new_orleans
from app.models.draft import DraftPatch
from app.models.insights import Observation
from app.models.profile import Contact
from app.services import drafts, duplicates, geo, jev, profiles, reports
from rapport_agent.prompt import NEXT_STEPS


@dataclass
class TurnActions:
    """Things the chat UI should offer after this turn (a draft to review, a photo upload)."""

    draft_id: str | None = None
    items: list[dict] = field(default_factory=list)


def build_tools(user_sub: str, actions: TurnActions) -> list:
    @tool
    def get_service_catalog() -> list[dict]:
        """List the NOLA 311 request types and the exact reasons residents can report."""
        return [
            {"request_type": t.name, "reasons": [r.name for r in t.reasons]}
            for t in SERVICE_CATALOG
        ]

    @tool
    def suggest_category(description: str) -> dict:
        """Suggest the best request type and reason for a problem the resident described.

        Args:
            description: The resident's own words about the problem.
        """
        obs = Observation(
            scene_description=description[:1200],
            image_quality="good",
            contains_person_or_plate=False,
            suggested_description=description[:600],
        )
        r = jev.get_jev().classify(obs, None, description)
        return {
            "request_type": r.suggested.request_type,
            "request_reason": r.suggested.request_reason,
            "confidence": round(r.reason_confidence, 2),
            "alternatives": [
                {"request_reason": a.request_reason, "probability": round(a.probability, 2)}
                for a in r.alternatives
                if a.request_type
            ],
            "severity": r.severity.label,
            "safety_hazard": r.safety_hazard >= 0.6,
        }

    @tool
    def find_address(query: str) -> dict:
        """Find a place in New Orleans from an address, intersection or landmark.

        Args:
            query: What the resident said, e.g. "Magazine and Napoleon" or "4000 Magazine St".
        """
        place = geo.get_geo().geocode(query)
        if place is None:
            return {"found": False, "message": "No match in New Orleans. Ask for more detail."}
        return {"found": True, "lat": place.lat, "lng": place.lng, "address": place.address}

    @tool
    def find_nearby_reports(request_type: str, lat: float, lng: float) -> list[dict]:
        """Open reports of the same type within 75 m (from residents or the City's 311 data).

        Args:
            request_type: "Roads and Streets" or "Drainage".
            lat: Latitude of the problem.
            lng: Longitude of the problem.
        """
        found = duplicates.nearby(request_type, lat, lng)[:3]
        return [
            {
                "request_reason": item["request_reason"],
                "distance_m": round(d),
                "status": item.get("status"),
                "reported": item["created_at"][:10],
                "source": "NOLA 311" if item.get("source") == "nola311" else "Rapport",
                "supporters": int(item.get("supporter_count", 0)),
                "yours": item.get("user_sub") == user_sub,
            }
            for d, item in found
        ]

    @tool
    def create_report_draft(
        request_type: str,
        request_reason: str,
        lat: float,
        lng: float,
        address: str,
        description: str,
    ) -> dict:
        """Prepare a report for the resident to review and submit. Never submits it.

        Args:
            request_type: "Roads and Streets" or "Drainage".
            request_reason: One of the exact reasons from get_service_catalog.
            lat: Latitude of the problem (from find_address or the resident).
            lng: Longitude of the problem.
            address: Nearest address or landmark, as the resident would say it.
            description: One or two factual sentences about the problem.
        """
        if not is_valid_pair(request_type, request_reason):
            return {"ok": False, "error": "That reason doesn't belong to that request type."}
        if not in_new_orleans(lat, lng):
            return {"ok": False, "error": "That location isn't in New Orleans."}
        draft = drafts.create(user_sub)
        me = profiles.get_profile(user_sub)
        patch: dict = {
            "step": 3,
            "request_type": request_type,
            "request_reason": request_reason,
            "location": {"lat": lat, "lng": lng, "address": address[:200], "source": "manual"},
            "description_html": f"<p>{description[:1800]}</p>",
        }
        if me.is_complete:
            patch["contact"] = Contact(
                first_name=me.first_name,
                last_name=me.last_name,
                email=me.email or "",
                phone=me.phone,
                phone_type=me.phone_type,
            ).model_dump()
        drafts.update(draft.id, user_sub, DraftPatch.model_validate(patch))
        actions.draft_id = draft.id
        actions.items.append({"type": "review_draft", "draft_id": draft.id})
        return {
            "ok": True,
            "draft_id": draft.id,
            "next": "Tell the resident to press Review & submit to check it and send it.",
            "contact_prefilled": me.is_complete,
        }

    @tool
    def list_my_reports(status: str = "all") -> list[dict]:
        """The resident's own reports, newest first.

        Args:
            status: "all", "open" or "resolved".
        """
        page = reports.list_mine(
            user_sub, status if status in ("all", "open", "resolved") else "all", 10
        )
        return [
            {
                "report_id": r.id,
                "request_reason": r.request_reason,
                "status": r.status,
                "address": r.address,
                "reported": r.created_at[:10],
                "nola311_ticket": r.nola311_ticket,
                "supporters": r.supporter_count,
            }
            for r in page.reports
        ]

    @tool
    def get_report_status(report_id: str) -> dict:
        """Status and timeline of one of the resident's own reports.

        Args:
            report_id: The id from list_my_reports.
        """
        try:
            d = reports.get_detail(report_id, user_sub)
        except reports.ReportNotFound:
            return {"found": False}
        if not d.is_owner:
            return {"found": False}
        return {
            "found": True,
            "request_reason": d.request_reason,
            "status": d.status,
            "nola311_ticket": d.nola311_ticket,
            "verified_with_city": d.nola311_verified,
            "timeline": [
                {"status": e.status, "note": e.note, "date": e.created_at[:10], "by": e.source}
                for e in d.events
            ],
        }

    @tool
    def explain_next_steps() -> str:
        """How filing with NOLA 311 and status tracking work after a report is submitted."""
        return NEXT_STEPS

    return [
        get_service_catalog,
        suggest_category,
        find_address,
        find_nearby_reports,
        create_report_draft,
        list_my_reports,
        get_report_status,
        explain_next_steps,
    ]
