import asyncio
import random
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import uuid4

from .agent import get_reasoner_mcp_status, run_formatter, run_reasoner
from .client import (
    SandboxClientError,
    find_default_agent_chat,
    get_chat,
    get_messages,
    send_message,
)
from .config import settings
from .memory import build_memory
from .schemas import (
    AgentRespondRequest,
    AgentRespondResponse,
    AgentStreamEvent,
    AgentStreamEventType,
    ConversationMemory,
    FormattedMessage,
    SandboxSendMessageRequest,
)


class AgentServiceError(Exception):
    def __init__(self, message: str, status_code: int = 500) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _event(
    event_type: AgentStreamEventType,
    run_id: str,
    *,
    chat_id: str | None = None,
    message_id: str | None = None,
    text: str | None = None,
    task_id: str | None = None,
    task_label: str | None = None,
    error: str | None = None,
    reason: str | None = None,
    payload: dict | None = None,
) -> AgentStreamEvent:
    return AgentStreamEvent(
        type=event_type,
        run_id=run_id,
        chat_id=chat_id,
        message_id=message_id,
        text=text,
        task_id=task_id,
        task_label=task_label,
        error=error,
        reason=reason,
        payload=payload,
        created_at=_now_iso(),
    )


def _send_delay_seconds(message: FormattedMessage) -> float:
    base_delay = (message.send_after_ms or 0) / 1000
    return base_delay + random.uniform(0, settings.agent_delay_jitter_max_seconds)


def _agent_already_replied(memory: ConversationMemory) -> bool:
    if not settings.agent_enable_idempotency:
        return False
    if memory.latest_user_message is None:
        return True
    if memory.latest_agent_message is None:
        return False

    return memory.latest_agent_message.created_at >= memory.latest_user_message.created_at


def _latest_user_message_id(memory: ConversationMemory) -> str | None:
    return memory.latest_user_message.id if memory.latest_user_message else None


async def _resolve_chat_id(request: AgentRespondRequest) -> str:
    if request.chat_id:
        return request.chat_id

    chat = await find_default_agent_chat()
    return chat.id


async def stream_response_events(
    request: AgentRespondRequest,
) -> AsyncIterator[AgentStreamEvent]:
    run_id = str(uuid4())
    chat_id: str | None = None

    try:
        chat_id = await _resolve_chat_id(request)
        await get_chat(chat_id)
        messages = await get_messages(chat_id)
        memory = build_memory(messages)
        target_user_message_id = _latest_user_message_id(memory)

        if memory.latest_user_message is None:
            yield _event(
                "run.completed",
                run_id,
                chat_id=chat_id,
                reason="no user message to respond to",
                payload={"status": "skipped", "message_ids": [], "messages": []},
            )
            return

        if _agent_already_replied(memory):
            yield _event(
                "run.completed",
                run_id,
                chat_id=chat_id,
                reason="agent already replied to latest user message",
                payload={"status": "skipped", "message_ids": [], "messages": []},
            )
            return

        reasoner_task_id = str(uuid4())
        yield _event(
            "task.started",
            run_id,
            chat_id=chat_id,
            task_id=reasoner_task_id,
            task_label="reasoner",
            payload={"mcp": get_reasoner_mcp_status()},
        )
        reasoner_output = await run_reasoner(memory)
        yield _event(
            "task.completed",
            run_id,
            chat_id=chat_id,
            task_id=reasoner_task_id,
            task_label="reasoner",
            payload={
                "should_reply": reasoner_output.should_reply,
                "needs_tool": reasoner_output.needs_tool,
                "tool_intent": reasoner_output.tool_intent,
                "mcp": get_reasoner_mcp_status(),
            },
        )

        if not reasoner_output.should_reply:
            yield _event(
                "run.completed",
                run_id,
                chat_id=chat_id,
                reason=reasoner_output.reason or "reasoner chose not to reply",
                payload={"status": "skipped", "message_ids": [], "messages": []},
            )
            return

        if not reasoner_output.draft_response.strip():
            yield _event(
                "run.completed",
                run_id,
                chat_id=chat_id,
                reason="reasoner returned an empty draft",
                payload={"status": "skipped", "message_ids": [], "messages": []},
            )
            return

        formatter_task_id = str(uuid4())
        yield _event(
            "task.started",
            run_id,
            chat_id=chat_id,
            task_id=formatter_task_id,
            task_label="formatter",
        )
        staged_messages = await run_formatter(reasoner_output.draft_response, memory)
        yield _event(
            "task.completed",
            run_id,
            chat_id=chat_id,
            task_id=formatter_task_id,
            task_label="formatter",
            payload={"message_count": len(staged_messages)},
        )

        message_ids: list[str] = []
        message_texts: list[str] = []
        for staged_message in staged_messages:
            current_memory = build_memory(await get_messages(chat_id))
            if _latest_user_message_id(current_memory) != target_user_message_id:
                yield _event(
                    "run.completed",
                    run_id,
                    chat_id=chat_id,
                    reason="newer user message arrived before this message was sent",
                    payload={
                        "status": "skipped",
                        "message_ids": message_ids,
                        "messages": message_texts,
                    },
                )
                return

            yield _event(
                "typing.started",
                run_id,
                chat_id=chat_id,
                payload={"sender_handle": settings.agent_sender_handle},
            )
            await asyncio.sleep(_send_delay_seconds(staged_message))

            current_memory = build_memory(await get_messages(chat_id))
            if _latest_user_message_id(current_memory) != target_user_message_id:
                yield _event(
                    "run.completed",
                    run_id,
                    chat_id=chat_id,
                    reason="newer user message arrived while this message was waiting",
                    payload={
                        "status": "skipped",
                        "message_ids": message_ids,
                        "messages": message_texts,
                    },
                )
                return

            response = await send_message(
                chat_id,
                SandboxSendMessageRequest(
                    text=staged_message.text,
                    direction="inbound",
                    sender_handle=settings.agent_sender_handle,
                ),
            )
            message_ids.append(response.message.id)
            message_texts.append(staged_message.text)
            yield _event(
                "message.persisted",
                run_id,
                chat_id=chat_id,
                message_id=response.message.id,
                text=response.message.text,
                payload=response.message.model_dump(mode="json"),
            )
            if response.message.is_delivered:
                yield _event(
                    "message.delivered",
                    run_id,
                    chat_id=chat_id,
                    message_id=response.message.id,
                )
            if response.message.is_read:
                yield _event(
                    "message.read",
                    run_id,
                    chat_id=chat_id,
                    message_id=response.message.id,
                )

        yield _event(
            "run.completed",
            run_id,
            chat_id=chat_id,
            payload={
                "status": "replied",
                "message_ids": message_ids,
                "messages": message_texts,
            },
        )
    except SandboxClientError as exc:
        yield _event(
            "error",
            run_id,
            chat_id=chat_id,
            error=exc.message,
            payload={"status_code": exc.status_code},
        )
    except Exception as exc:
        yield _event("error", run_id, chat_id=chat_id, error=f"agent_error: {exc}")


async def respond_to_chat(request: AgentRespondRequest) -> AgentRespondResponse:
    chat_id: str | None = request.chat_id
    last_reason: str | None = None
    message_ids: list[str] = []
    messages: list[str] = []
    status = "skipped"

    async for event in stream_response_events(request):
        if event.chat_id is not None:
            chat_id = event.chat_id

        if event.type == "message.persisted":
            if event.message_id:
                message_ids.append(event.message_id)
            if event.text:
                messages.append(event.text)
            status = "replied"
        elif event.type == "run.completed":
            last_reason = event.reason
            if event.payload:
                status = event.payload.get("status", status)
                message_ids = event.payload.get("message_ids", message_ids)
                messages = event.payload.get("messages", messages)
        elif event.type == "error":
            status_code = 500
            if event.payload and isinstance(event.payload.get("status_code"), int):
                status_code = event.payload["status_code"]
            raise AgentServiceError(event.error or "agent_error", status_code)

    return AgentRespondResponse(
        chat_id=chat_id or "",
        status=status,
        messages=messages,
        message_ids=message_ids,
        reason=last_reason,
    )
