from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import CurrentUserDep
from app.services import agent_client
from app.services.dispatch import dispatch

router = APIRouter(prefix="/agent", tags=["agent"])


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    message: str = Field(min_length=1, max_length=2000)


class ChatTurn(BaseModel):
    """One chat turn. `pending` until the agent answers; poll GET /agent/turns/{turn_id}."""

    turn_id: str
    status: Literal["pending", "done", "error"]
    reply: str | None = None
    draft_id: str | None = None
    actions: list[dict] = []
    off_topic: bool = False


@router.post("/chat", status_code=status.HTTP_202_ACCEPTED)
def chat(body: ChatRequest, user: CurrentUserDep, background: BackgroundTasks) -> ChatTurn:
    # Agent turns take 10-25 s, too close to API Gateway's 30 s limit to wait for, so
    # the worker runs them and the site polls.
    try:
        # The agent acts for the verified user only; the client never sends a user id.
        turn = agent_client.start_turn(user.sub, body.session_id, body.message.strip())
    except agent_client.LimitReached as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, exc.message) from None
    if turn["status"] == "pending":
        dispatch("agent_turn", turn["turn_id"], background)
    return ChatTurn(**turn)


@router.get("/turns/{turn_id}")
def get_turn(turn_id: str, user: CurrentUserDep) -> ChatTurn:
    try:
        return ChatTurn(**agent_client.get_turn(turn_id, user.sub))
    except agent_client.TurnNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat turn not found") from None
