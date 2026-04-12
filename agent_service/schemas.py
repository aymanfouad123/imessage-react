from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


MessageDirection = Literal["inbound", "outbound"]


class HealthResponse(BaseModel):
    status: str


class AgentRespondRequest(BaseModel):
    chat_id: str | None = None


class AgentRespondResponse(BaseModel):
    chat_id: str
    bubbles: list[str]
    message_ids: list[str]


class AgentChatBubble(BaseModel):
    text: str = Field(min_length=1)


class AgentOutput(BaseModel):
    bubbles: list[AgentChatBubble] = Field(min_length=1, max_length=3)


class SandboxChatHandle(BaseModel):
    id: str
    handle: str
    service: str
    is_me: bool


class SandboxChat(BaseModel):
    id: str
    display_name: str
    handles: list[SandboxChatHandle]
    service: str
    is_group: bool
    created_at: str
    updated_at: str
    unread_count: int | None = None
    is_agent_chat: bool | None = None


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


class SandboxSendMessageRequest(BaseModel):
    text: str = Field(min_length=1)
    direction: MessageDirection = "outbound"
    sender_handle: str | None = None


class SandboxListChatsResponse(BaseModel):
    chats: list[SandboxChat]


class SandboxChatResponse(BaseModel):
    chat: SandboxChat


class SandboxMessagesResponse(BaseModel):
    messages: list[SandboxMessage]


class SandboxSendMessageResponse(BaseModel):
    chat: SandboxChat
    message: SandboxMessage


class SandboxReadChatResponse(BaseModel):
    chat: SandboxChat
    messages: list[SandboxMessage]


class SandboxErrorResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    error: str | None = None
