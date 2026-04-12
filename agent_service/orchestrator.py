import asyncio
import random

from agent import run_responder
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
    SandboxMessage,
    SandboxSendMessageRequest,
)


class AgentServiceError(Exception):
    def __init__(self, message: str, status_code: int = 500) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _bubble_delay_seconds(bubble: str, index: int) -> float:
    if index == 0:
        base_delay = settings.agent_first_bubble_delay_seconds
    else:
        chars_per_second = max(settings.agent_typing_chars_per_second, 1)
        base_delay = len(bubble) / chars_per_second
        base_delay = max(base_delay, settings.agent_min_bubble_delay_seconds)
        base_delay = min(base_delay, settings.agent_max_bubble_delay_seconds)

    return base_delay + random.uniform(0, 0.35)


def _latest_actionable_inbound(messages: list[SandboxMessage]) -> SandboxMessage | None:
    for message in reversed(messages):
        if not message.is_from_me and message.from_handle != settings.agent_sender_handle:
            return message
    return None


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

        latest_inbound = _latest_actionable_inbound(messages)
        if latest_inbound is not None and not latest_inbound.is_read:
            await mark_chat_read(chat_id)
            messages = await get_messages(chat_id)

        memory = build_memory(messages)
        agent_output = await run_responder(memory)
        bubbles = normalize_bubbles(agent_output)

        message_ids: list[str] = []
        for index, bubble in enumerate(bubbles):
            await asyncio.sleep(_bubble_delay_seconds(bubble, index))

            response = await send_message(
                chat_id,
                SandboxSendMessageRequest(
                    text=bubble,
                    direction="inbound",
                    sender_handle=settings.agent_sender_handle,
                ),
            )
            message_ids.append(response.message.id)

        return AgentRespondResponse(
            chat_id=chat_id,
            bubbles=bubbles,
            message_ids=message_ids,
        )
    except SandboxClientError as exc:
        raise AgentServiceError(exc.message, exc.status_code) from exc
    except Exception as exc:
        raise AgentServiceError(f"agent_error: {exc}") from exc
