"""TypeSafe Jev: fast, typed decisions over Claude's observation of a photo."""

import json
from functools import lru_cache
from typing import Protocol

import boto3
from typesafe_sdk import Choice, Noul, RetryPolicy, Score, TypeSafeClient

from app.catalog import SERVICE_CATALOG
from app.config import get_settings
from app.models.insights import Observation, ReasonOption, Severity

NOT_AN_ISSUE = "Not a street or drainage problem"

SEVERITY_LEVELS = [
    "Minor: cosmetic, no effect on travel or drainage",
    "Moderate: noticeable, should be fixed but not urgent",
    "Serious: damages vehicles, blocks walking paths or causes flooding after rain",
    "Hazardous: immediate danger, such as a deep open hole, missing cover or deep water",
]
SEVERITY_LABELS = ["Minor", "Moderate", "Serious", "Hazardous"]

_REASON_TYPE = {r.name: t.name for t in SERVICE_CATALOG for r in t.reasons}


class JevResult:
    def __init__(
        self,
        suggested: ReasonOption,
        alternatives: list[ReasonOption],
        reason_confidence: float,
        severity: Severity,
        is_actionable: float,
        safety_hazard: float,
        matches_selection: float | None,
    ):
        self.suggested = suggested
        self.alternatives = alternatives
        self.reason_confidence = reason_confidence
        self.severity = severity
        self.is_actionable = is_actionable
        self.safety_hazard = safety_hazard
        self.matches_selection = matches_selection


def _state(obs: Observation, selected_reason: str | None, description: str | None) -> str:
    return json.dumps(
        {
            "photo": {
                "scene": obs.scene_description,
                "objects": obs.visible_objects,
                "image_quality": obs.image_quality,
            },
            "resident_selected_reason": selected_reason,
            "resident_description": description,
        }
    )


def _questions(selected_reason: str | None) -> dict:
    criteria = {r.name: r.description for t in SERVICE_CATALOG for r in t.reasons}
    criteria[NOT_AN_ISSUE] = "The photo doesn't show a road, sidewalk or drainage problem."
    questions = {
        "request_reason": Choice(
            instructions="Which NOLA 311 request reason best fits the problem in the photo?",
            criteria=criteria,
        ),
        "severity": Score(
            instructions="How severe is the problem shown in the photo?",
            criteria=SEVERITY_LEVELS,
        ),
        "is_actionable": Noul(
            instructions="The photo shows a problem on a public street, sidewalk or drain "
            "that a city crew could fix.",
        ),
        "safety_hazard": Noul(
            instructions="The problem is an immediate danger to drivers, cyclists or pedestrians.",
        ),
    }
    if selected_reason:
        questions["matches_selection"] = Noul(
            instructions="The problem in the photo matches the reason the resident selected.",
        )
    return questions


def _option(reason: str, probability: float) -> ReasonOption:
    return ReasonOption(
        request_type=_REASON_TYPE.get(reason), request_reason=reason, probability=probability
    )


def _same_issue_state(new: dict, existing: dict) -> str:
    return json.dumps({"new_report": new, "existing_report": existing})


SAME_ISSUE = Noul(
    instructions="The new report and the existing report describe the same physical problem "
    "at the same spot (not just a similar problem nearby).",
)


class Jev(Protocol):
    def classify(
        self, obs: Observation, selected_reason: str | None, description: str | None
    ) -> JevResult: ...

    def same_issue(self, new: dict, existing: dict) -> float: ...


class TypeSafeJev:
    def __init__(self, api_key: str):
        self.client = TypeSafeClient(
            api_key=api_key,
            model="jev",
            timeout=15.0,
            retry=RetryPolicy(max_retries=2, backoff_max=1.0, timeout=15.0),
        )

    def same_issue(self, new, existing):
        res = self.client.system_one(_same_issue_state(new, existing), {"same_issue": SAME_ISSUE})
        return res.nouls["same_issue"].noul

    def classify(self, obs, selected_reason, description):
        res = self.client.system_one(
            _state(obs, selected_reason, description), _questions(selected_reason)
        )
        reason = res.choices["request_reason"]
        ranked = sorted(reason.probabilities.items(), key=lambda kv: kv[1], reverse=True)
        severity = res.scores["severity"]
        # Score levels are 0-based in the API; our levels are 1-4.
        level = min(max(round(severity.score) + 1, 1), 4)
        return JevResult(
            suggested=_option(reason.choice, reason.probabilities.get(reason.choice, 0.0)),
            alternatives=[_option(r, p) for r, p in ranked[1:3]],
            reason_confidence=reason.confidence,
            severity=Severity(
                level=level,
                label=SEVERITY_LABELS[level - 1],
                score=severity.score,
                confidence=severity.confidence,
            ),
            is_actionable=res.nouls["is_actionable"].noul,
            safety_hazard=res.nouls["safety_hazard"].noul,
            matches_selection=res.nouls["matches_selection"].noul
            if "matches_selection" in res.nouls
            else None,
        )


class FakeJev:
    def same_issue(self, new, existing):
        # Same reason within 30 m reads as the same problem.
        close = existing.get("distance_m", 999) <= 30
        return 0.9 if close and new.get("reason") == existing.get("reason") else 0.2

    def classify(self, obs, selected_reason, description):
        return JevResult(
            suggested=_option("Catch Basin Clogged", 0.91),
            alternatives=[
                _option("Catch Basin Not Draining", 0.06),
                _option("Street Flooding", 0.02),
            ],
            reason_confidence=0.91,
            severity=Severity(level=3, label="Serious", score=2.1, confidence=0.8),
            is_actionable=0.97,
            safety_hazard=0.2,
            matches_selection=None
            if selected_reason is None
            else (0.95 if selected_reason == "Catch Basin Clogged" else 0.1),
        )


def _api_key() -> str:
    settings = get_settings()
    if settings.typesafe_api_key:
        return settings.typesafe_api_key
    ssm = boto3.client("ssm", region_name=settings.aws_region)
    return ssm.get_parameter(Name=settings.typesafe_key_param, WithDecryption=True)["Parameter"][
        "Value"
    ]


@lru_cache
def get_jev() -> Jev:
    if get_settings().ai_mode == "fake":
        return FakeJev()
    return TypeSafeJev(_api_key())
