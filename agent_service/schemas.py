from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


MessageDirection = Literal["inbound", "outbound"]
MemorySenderType = Literal["user", "agent"]


class HealthResponse(BaseModel):
    status: str


class AgentRespondRequest(BaseModel):
    chat_id: str | None = None


class AgentRespondResponse(BaseModel):
    chat_id: str
    status: Literal["replied", "skipped"] = "replied"
    bubbles: list[str]
    message_ids: list[str]
    reason: str | None = None


class ReasonerOutput(BaseModel):
    should_reply: bool = True
    draft_response: str = ""
    reason: str | None = None
    needs_tool: bool = False
    tool_intent: str | None = None


class FormattedBubble(BaseModel):
    text: str = Field(min_length=1)
    send_after_ms: int | None = None


class FormatterOutput(BaseModel):
    bubbles: list[FormattedBubble] = Field(min_length=1, max_length=10)


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
