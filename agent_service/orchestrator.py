import asyncio
import random

from agent import run_formatter, run_reasoner
from chat_style import normalize_bubbles
from client import (
    SandboxClientError,
    find_default_agent_chat,
    get_chat,
    get_messages,
    mark_chat_read,
    send_message,
)
from config import settings
from memory import build_memory
from schemas import (
    AgentRespondRequest,
    AgentRespondResponse,
    ConversationMemory,
    FormattedBubble,
    SandboxMessage,
    SandboxSendMessageRequest,
)


class AgentServiceError(Exception):
    def __init__(self, message: str, status_code: int = 500) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _bubble_delay_seconds(bubble: FormattedBubble) -> float:
    base_delay = (bubble.send_after_ms or 0) / 1000
    return base_delay + random.uniform(0, settings.agent_delay_jitter_max_seconds)


def _latest_unread_non_agent_inbound(
    messages: list[SandboxMessage],
) -> SandboxMessage | None:
    for message in reversed(messages):
        if not message.is_from_me and message.from_handle != settings.agent_sender_handle:
            return message
    return None


def _agent_already_replied(memory: ConversationMemory) -> bool:
    if not settings.agent_enable_idempotency:
        return False
    if memory.latest_user_message is None:
        return True
    if memory.latest_agent_message is None:
        return False

    return memory.latest_agent_message.created_at >= memory.latest_user_message.created_at


async def _resolve_chat_id(request: AgentRespondRequest) -> str:
    if request.chat_id:
        return request.chat_id

    chat = await find_default_agent_chat()
    return chat.id


async def respond_to_chat(request: AgentRespondRequest) -> AgentRespondResponse:
    try:
        chat_id = await _resolve_chat_id(request)
        await get_chat(chat_id)
        messages = await get_messages(chat_id)
        memory = build_memory(messages)

        if memory.latest_user_message is None:
            return AgentRespondResponse(
                chat_id=chat_id,
                status="skipped",
                bubbles=[],
                message_ids=[],
                reason="no user message to respond to",
            )

        if _agent_already_replied(memory):
            return AgentRespondResponse(
                chat_id=chat_id,
                status="skipped",
                bubbles=[],
                message_ids=[],
                reason="agent already replied to latest user message",
            )

        latest_inbound = _latest_unread_non_agent_inbound(messages)
        if latest_inbound is not None and not latest_inbound.is_read:
            await mark_chat_read(chat_id)
            messages = await get_messages(chat_id)
            memory = build_memory(messages)

        reasoner_output = await run_reasoner(memory)
        if not reasoner_output.should_reply:
            return AgentRespondResponse(
                chat_id=chat_id,
                status="skipped",
                bubbles=[],
                message_ids=[],
                reason=reasoner_output.reason or "reasoner chose not to reply",
            )
        if not reasoner_output.draft_response.strip():
            return AgentRespondResponse(
                chat_id=chat_id,
                status="skipped",
                bubbles=[],
                message_ids=[],
                reason="reasoner returned an empty draft",
            )

        formatter_output = await run_formatter(reasoner_output.draft_response, memory)
        bubbles = normalize_bubbles(formatter_output)

        message_ids: list[str] = []
        for bubble in bubbles:
            await asyncio.sleep(_bubble_delay_seconds(bubble))

            response = await send_message(
                chat_id,
                SandboxSendMessageRequest(
                    text=bubble.text,
                    direction="inbound",
                    sender_handle=settings.agent_sender_handle,
                ),
            )
            message_ids.append(response.message.id)

        return AgentRespondResponse(
            chat_id=chat_id,
            status="replied",
            bubbles=[bubble.text for bubble in bubbles],
            message_ids=message_ids,
        )
    except SandboxClientError as exc:
        raise AgentServiceError(exc.message, exc.status_code) from exc
    except Exception as exc:
        raise AgentServiceError(f"agent_error: {exc}") from exc
