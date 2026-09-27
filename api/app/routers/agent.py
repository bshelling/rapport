from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import CurrentUserDep
from app.services import agent_client

router = APIRouter(prefix="/agent", tags=["agent"])


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    message: str = Field(min_length=1, max_length=2000)


class ChatReply(BaseModel):
    reply: str
    draft_id: str | None = None
    actions: list[dict] = []
    off_topic: bool = False


@router.post("/chat")
def chat(body: ChatRequest, user: CurrentUserDep) -> ChatReply:
    try:
        # The agent acts for the verified user only; the client never sends a user id.
        return ChatReply(**agent_client.chat(user.sub, body.session_id, body.message.strip()))
    except agent_client.LimitReached as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, exc.message) from None
