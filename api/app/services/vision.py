"""Claude vision on Amazon Bedrock: describe a street photo as structured data.

Claude in Amazon Bedrock doesn't support structured outputs, so the model
reports through a single tool call and we validate the input with Pydantic.
"""

import base64
from functools import lru_cache
from typing import Protocol

from anthropic import AnthropicBedrock, AnthropicBedrockMantle
from pydantic import ValidationError

from app.config import get_settings
from app.models.insights import Observation

SYSTEM = """You help residents of New Orleans report street and drainage problems to the \
City's 311 service. You look at one photo a resident took and describe it factually for \
the City's crews. Never guess at things you can't see. Always answer by calling the \
record_observation tool exactly once."""

TOOL = {
    "name": "record_observation",
    "description": "Record what the photo shows.",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "scene_description",
            "visible_objects",
            "landmarks",
            "image_quality",
            "contains_person_or_plate",
            "suggested_description",
        ],
        "properties": {
            "scene_description": {
                "type": "string",
                "description": "2-4 plain sentences on the road, sidewalk or drainage "
                "feature and its condition: size, depth, water, debris, damage.",
            },
            "visible_objects": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Short nouns, e.g. 'pothole', 'catch basin grate', "
                "'standing water', 'leaves', 'manhole cover', 'curb', 'cracked sidewalk'.",
            },
            "landmarks": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Readable street signs, business names or addresses. Empty if none.",
            },
            "image_quality": {
                "type": "string",
                "enum": ["good", "blurry", "too_dark", "too_far", "not_a_street_scene"],
            },
            "contains_person_or_plate": {
                "type": "boolean",
                "description": "True if a recognizable face or a readable license plate "
                "is visible.",
            },
            "suggested_description": {
                "type": "string",
                "description": "One or two sentences describing the problem itself (not "
                "the photo) that the resident could submit to 311: factual, no location "
                "details. Empty string if no street or drainage problem is visible.",
            },
        },
    },
}


class VisionError(Exception):
    pass


class Vision(Protocol):
    def observe(self, jpeg: bytes) -> Observation: ...


class BedrockVision:
    def __init__(self, model: str, region: str):
        self.model = model
        # Newer models (anthropic.claude-*) use the Messages-API endpoint (Mantle);
        # older ones are reached through cross-region inference profiles
        # (us./global.anthropic.claude-*) on the InvokeModel endpoint.
        if model.startswith("anthropic."):
            self.client = AnthropicBedrockMantle(aws_region=region, timeout=45.0, max_retries=2)
        else:
            self.client = AnthropicBedrock(aws_region=region, timeout=45.0, max_retries=2)

    def observe(self, jpeg: bytes) -> Observation:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=4000,
            system=SYSTEM,
            output_config={"effort": "low"},
            tools=[TOOL],
            tool_choice={"type": "auto"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": base64.standard_b64encode(jpeg).decode(),
                            },
                        },
                        {"type": "text", "text": "Record what this photo shows."},
                    ],
                }
            ],
        )
        if response.stop_reason == "refusal":
            raise VisionError("model declined to describe the photo")
        call = next(
            (b for b in response.content if b.type == "tool_use" and b.name == TOOL["name"]),
            None,
        )
        if call is None:
            raise VisionError(f"no observation returned (stop_reason={response.stop_reason})")
        try:
            return Observation.model_validate(call.input)
        except ValidationError as exc:
            raise VisionError(f"invalid observation: {exc.error_count()} errors") from exc


class FakeVision:
    """Deterministic stand-in for tests and offline development."""

    def observe(self, jpeg: bytes) -> Observation:
        return Observation(
            scene_description="A catch basin grate at the curb is covered with wet leaves; "
            "water is pooling in the gutter around it.",
            visible_objects=["catch basin grate", "leaves", "standing water", "curb"],
            landmarks=[],
            image_quality="good",
            contains_person_or_plate=False,
            suggested_description="The catch basin is clogged with leaves and water is "
            "pooling in the street around it.",
        )


@lru_cache
def get_vision() -> Vision:
    settings = get_settings()
    if settings.ai_mode == "fake":
        return FakeVision()
    return BedrockVision(settings.claude_model, settings.aws_region)
