from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


MemorySenderType = Literal["user", "agent"]


class HealthResponse(BaseModel):
    status: str


class ReasonerOutput(BaseModel):
    should_reply: bool = True
    draft_response: str = ""
    reason: str | None = None


class MemoryMessage(BaseModel):
    id: str
    sender_type: MemorySenderType
    sender: str
    text: str
    created_at: str


class ConversationMemory(BaseModel):
    messages: list[MemoryMessage]
    latest_user_message: MemoryMessage | None = None
    latest_agent_message: MemoryMessage | None = None


class SandboxMessage(BaseModel):
    id: str
    chat_id: str
    from_handle: str | None = None
    is_from_me: bool
    text: str
    created_at: str
    sent_at: str
    delivered_at: str | None
    read_at: str | None
    is_delivered: bool
    is_read: bool


class AgentRunTrigger(BaseModel):
    reason: Literal["user_message"] = "user_message"
    message_id: str


class AgentRunContext(BaseModel):
    recent_messages: list[SandboxMessage]
    agent_handle: str


class AgentRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    chat_id: str
    trigger: AgentRunTrigger
    context: AgentRunContext
