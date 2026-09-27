"""One chat turn: build the agent for this resident and session, run it, report actions."""

import logging
import os

from pydantic import BaseModel, Field
from strands import Agent
from strands.models import BedrockModel

from rapport_agent.prompt import SYSTEM_PROMPT
from rapport_agent.tools import TurnActions, build_tools

log = logging.getLogger(__name__)

# Opus 5 needs a Bedrock model agreement (pending); Opus 4.6 is the best Claude available now.
DEFAULT_MODEL = "us.anthropic.claude-opus-4-6-v1"


class ChatTurn(BaseModel):
    user_sub: str = Field(min_length=1)
    session_id: str = Field(min_length=8, max_length=100)
    message: str = Field(min_length=1, max_length=2000)


# Local dev has no AgentCore Memory; keep conversations in-process instead.
_LOCAL_HISTORY: dict[str, list] = {}


def _session_manager(user_sub: str, session_id: str):
    memory_id = os.environ.get("RAPPORT_AGENT_MEMORY_ID")
    if not memory_id:
        return None  # local dev: no cross-turn memory
    from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
    from bedrock_agentcore.memory.integrations.strands.session_manager import (
        AgentCoreMemorySessionManager,
    )

    return AgentCoreMemorySessionManager(
        AgentCoreMemoryConfig(memory_id=memory_id, session_id=session_id, actor_id=user_sub),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )


def build_agent(turn: ChatTurn, actions: TurnActions, model=None) -> Agent:
    model = model or BedrockModel(
        model_id=os.environ.get("RAPPORT_AGENT_MODEL", DEFAULT_MODEL),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        max_tokens=1500,
    )
    session_manager = _session_manager(turn.user_sub, turn.session_id)
    history = None
    if session_manager is None:
        history = list(_LOCAL_HISTORY.get(f"{turn.user_sub}/{turn.session_id}", []))
    return Agent(
        model=model,
        messages=history,
        system_prompt=SYSTEM_PROMPT,
        tools=build_tools(turn.user_sub, actions),
        session_manager=session_manager,
        callback_handler=None,
    )


def turn_text(messages: list[dict]) -> str:
    """All assistant text from this turn. str(result) only keeps the text after the last
    tool call, which drops what the model said between tools."""
    parts = [
        block["text"].strip()
        for m in messages
        if m.get("role") == "assistant"
        for block in m.get("content", [])
        if isinstance(block, dict) and block.get("text", "").strip()
    ]
    return "\n\n".join(parts)


def handle(payload: dict, model=None) -> dict:
    turn = ChatTurn.model_validate(payload)
    actions = TurnActions()
    agent = build_agent(turn, actions, model)
    start = len(agent.messages)  # history restored from memory comes first
    result = agent(turn.message)
    final = str(result).strip()
    # The last message is the answer; if it's only a fragment (the model split its reply
    # around tool calls), fall back to everything it said this turn.
    reply = final if len(final.split()) >= 12 else (turn_text(agent.messages[start:]) or final)
    if not os.environ.get("RAPPORT_AGENT_MEMORY_ID"):
        _LOCAL_HISTORY[f"{turn.user_sub}/{turn.session_id}"] = list(agent.messages)
    log.info("turn done: tools=%s draft=%s", list(result.metrics.tool_metrics), actions.draft_id)
    return {"reply": reply, "draft_id": actions.draft_id, "actions": actions.items}
