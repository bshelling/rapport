"""Service request types and reasons, using the exact NOLA 311 strings
(verified against data.nola.gov dataset 2jgv-pqrq)."""

from pydantic import BaseModel


class Reason(BaseModel):
    name: str
    description: str


class ServiceType(BaseModel):
    name: str
    description: str
    reasons: list[Reason]


SERVICE_CATALOG: list[ServiceType] = [
    ServiceType(
        name="Roads and Streets",
        description="Potholes, damaged sidewalks and sinking streets.",
        reasons=[
            Reason(name="Pothole", description="A hole or broken pavement in the roadway."),
            Reason(
                name="Sidewalk Damaged or Missing",
                description="Cracked, lifted, crumbling or missing sidewalk.",
            ),
            Reason(
                name="Street Subsidence (Sinking)",
                description="Part of the street is sinking or has a depression.",
            ),
        ],
    ),
    ServiceType(
        name="Drainage",
        description="Catch basins, drain covers and street flooding.",
        reasons=[
            Reason(
                name="Catch Basin Not Draining",
                description="Water pools around a catch basin after rain.",
            ),
            Reason(
                name="Catch Basin Clogged",
                description="Leaves, trash or debris are blocking a catch basin.",
            ),
            Reason(
                name="Catch Basin Frame and Cover Missing or Damaged",
                description="The grate or frame is broken, loose or missing.",
            ),
            Reason(
                name="Drainage Manhole Cover Missing or Damaged",
                description="A drainage manhole cover is broken, shifted or missing.",
            ),
            Reason(
                name="Street Flooding",
                description="Standing water on the street that isn't draining.",
            ),
        ],
    ),
]

REASONS_BY_TYPE: dict[str, set[str]] = {
    t.name: {r.name for r in t.reasons} for t in SERVICE_CATALOG
}


def is_valid_pair(request_type: str | None, request_reason: str | None) -> bool:
    return request_reason in REASONS_BY_TYPE.get(request_type or "", set())
