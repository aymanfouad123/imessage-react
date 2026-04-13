import asyncio
import logging
import random
import time
from collections.abc import AsyncIterator
from contextlib import suppress
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
    AgentRunStatus,
    AgentStreamEvent,
    AgentStreamEventType,
    ConversationMemory,
    FormattedMessage,
    ReasonerOutput,
    SandboxSendMessageRequest,
    ToolRunSummary,
)


logger = logging.getLogger(__name__)


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


def _log_event(event: AgentStreamEvent) -> AgentStreamEvent:
    logger.info(
        "agent.event type=%s chat_id=%s task_label=%s message_id=%s reason=%s payload=%s",
        event.type,
        event.chat_id,
        event.task_label,
        event.message_id,
        event.reason,
        event.payload,
    )
    return event


def _emit(
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
    return _log_event(
        _event(
            event_type,
            run_id,
            chat_id=chat_id,
            message_id=message_id,
            text=text,
            task_id=task_id,
            task_label=task_label,
            error=error,
            reason=reason,
            payload=payload,
        )
    )


def _send_delay_seconds(message: FormattedMessage) -> float:
    base_delay = (message.send_after_ms or 0) / 1000
    return base_delay + random.uniform(0, settings.agent_delay_jitter_max_seconds)


def _typing_lead_seconds(send_delay_seconds: float) -> float:
    return min(send_delay_seconds, max(settings.agent_typing_lead_seconds, 0))


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


async def _cancel_task(task: asyncio.Task) -> None:
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def _resolve_chat_id(request: AgentRespondRequest) -> str:
    if request.chat_id:
        return request.chat_id

    chat = await find_default_agent_chat()
    return chat.id


def _run_completed_payload(
    status: AgentRunStatus,
    message_ids: list[str] | None = None,
    messages: list[str] | None = None,
    **extra: object,
) -> dict:
    payload = {
        "status": status,
        "message_ids": message_ids or [],
        "messages": messages or [],
    }
    payload.update({key: value for key, value in extra.items() if value is not None})
    return payload


def _derive_run_status(
    reasoner_output: ReasonerOutput,
    tool_summary: ToolRunSummary,
    messages: list[str],
) -> AgentRunStatus:
    if tool_summary.failed:
        return "failed"
    if tool_summary.real_tool_action_completed:
        return "task_completed"
    if not messages:
        return "skipped"
    if reasoner_output.needs_tool:
        return "in_progress"

    return "message_sent"


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
            yield _emit(
                "run.completed",
                run_id,
                chat_id=chat_id,
                reason="no user message to respond to",
                payload=_run_completed_payload("skipped"),
            )
            return

        if _agent_already_replied(memory):
            yield _emit(
                "run.completed",
                run_id,
                chat_id=chat_id,
                reason="agent already replied to latest user message",
                payload=_run_completed_payload("skipped"),
            )
            return

        reasoner_task_id = str(uuid4())
        yield _emit(
            "task.started",
            run_id,
            chat_id=chat_id,
            task_id=reasoner_task_id,
            task_label="reasoner",
            payload={"mcp": get_reasoner_mcp_status()},
        )
        reasoner_task = asyncio.create_task(run_reasoner(memory))
        reasoner_started_at = time.monotonic()
        while True:
            elapsed = time.monotonic() - reasoner_started_at
            remaining = settings.agent_reasoner_timeout_seconds - elapsed
            if remaining <= 0:
                await _cancel_task(reasoner_task)
                reason = "reasoner timed out while waiting for model or MCP responses"
                yield _emit(
                    "error",
                    run_id,
                    chat_id=chat_id,
                    task_id=reasoner_task_id,
                    task_label="reasoner",
                    error="reasoner_timeout",
                    reason=reason,
                    payload={"timeout_seconds": settings.agent_reasoner_timeout_seconds},
                )
                yield _emit(
                    "run.completed",
                    run_id,
                    chat_id=chat_id,
                    reason=reason,
                    payload=_run_completed_payload("failed"),
                )
                return

            try:
                reasoner_result = await asyncio.wait_for(
                    asyncio.shield(reasoner_task),
                    timeout=min(
                        settings.agent_task_update_interval_seconds,
                        remaining,
                    ),
                )
                break
            except TimeoutError:
                yield _emit(
                    "task.update",
                    run_id,
                    chat_id=chat_id,
                    task_id=reasoner_task_id,
                    task_label="reasoner",
                    reason="waiting for model or MCP responses",
                    payload={
                        "elapsed_seconds": round(
                            time.monotonic() - reasoner_started_at, 2
                        ),
                        "mcp": get_reasoner_mcp_status(),
                    },
                )

        reasoner_output = reasoner_result.output
        tool_summary = reasoner_result.tool_summary
        yield _emit(
            "task.completed",
            run_id,
            chat_id=chat_id,
            task_id=reasoner_task_id,
            task_label="reasoner",
            payload={
                "should_reply": reasoner_output.should_reply,
                "needs_tool": reasoner_output.needs_tool,
                "tool_intent": reasoner_output.tool_intent,
                "tool_summary": tool_summary.model_dump(),
                "mcp": get_reasoner_mcp_status(),
            },
        )

        if not reasoner_output.should_reply:
            yield _emit(
                "run.completed",
                run_id,
                chat_id=chat_id,
                reason=reasoner_output.reason or "reasoner chose not to reply",
                payload=_run_completed_payload(
                    "skipped",
                    tool_summary=tool_summary.model_dump(),
                ),
            )
            return

        if not reasoner_output.draft_response.strip():
            yield _emit(
                "run.completed",
                run_id,
                chat_id=chat_id,
                reason="reasoner returned an empty draft",
                payload=_run_completed_payload(
                    "skipped",
                    tool_summary=tool_summary.model_dump(),
                ),
            )
            return

        formatter_task_id = str(uuid4())
        yield _emit(
            "task.started",
            run_id,
            chat_id=chat_id,
            task_id=formatter_task_id,
            task_label="formatter",
        )
        formatter_task = asyncio.create_task(
            run_formatter(reasoner_output.draft_response, memory)
        )
        formatter_started_at = time.monotonic()
        while True:
            elapsed = time.monotonic() - formatter_started_at
            remaining = settings.agent_formatter_timeout_seconds - elapsed
            if remaining <= 0:
                await _cancel_task(formatter_task)
                reason = "formatter timed out while preparing messages"
                yield _emit(
                    "error",
                    run_id,
                    chat_id=chat_id,
                    task_id=formatter_task_id,
                    task_label="formatter",
                    error="formatter_timeout",
                    reason=reason,
                    payload={"timeout_seconds": settings.agent_formatter_timeout_seconds},
                )
                yield _emit(
                    "run.completed",
                    run_id,
                    chat_id=chat_id,
                    reason=reason,
                    payload=_run_completed_payload(
                        "failed",
                        tool_summary=tool_summary.model_dump(),
                    ),
                )
                return

            try:
                staged_messages = await asyncio.wait_for(
                    asyncio.shield(formatter_task),
                    timeout=min(
                        settings.agent_task_update_interval_seconds,
                        remaining,
                    ),
                )
                break
            except TimeoutError:
                yield _emit(
                    "task.update",
                    run_id,
                    chat_id=chat_id,
                    task_id=formatter_task_id,
                    task_label="formatter",
                    reason="waiting for message formatting",
                    payload={
                        "elapsed_seconds": round(
                            time.monotonic() - formatter_started_at, 2
                        )
                    },
                )

        yield _emit(
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
                yield _emit(
                    "run.completed",
                    run_id,
                    chat_id=chat_id,
                    reason="newer user message arrived before this message was sent",
                    payload=_run_completed_payload(
                        "in_progress" if message_ids else "skipped",
                        message_ids,
                        message_texts,
                        tool_summary=tool_summary.model_dump(),
                    ),
                )
                return

            send_delay_seconds = _send_delay_seconds(staged_message)
            typing_lead_seconds = _typing_lead_seconds(send_delay_seconds)
            await asyncio.sleep(send_delay_seconds - typing_lead_seconds)

            current_memory = build_memory(await get_messages(chat_id))
            if _latest_user_message_id(current_memory) != target_user_message_id:
                yield _emit(
                    "run.completed",
                    run_id,
                    chat_id=chat_id,
                    reason="newer user message arrived while this message was waiting",
                    payload=_run_completed_payload(
                        "in_progress" if message_ids else "skipped",
                        message_ids,
                        message_texts,
                        tool_summary=tool_summary.model_dump(),
                    ),
                )
                return

            yield _emit(
                "typing.started",
                run_id,
                chat_id=chat_id,
                payload={"sender_handle": settings.agent_sender_handle},
            )
            await asyncio.sleep(typing_lead_seconds)

            current_memory = build_memory(await get_messages(chat_id))
            if _latest_user_message_id(current_memory) != target_user_message_id:
                yield _emit(
                    "run.completed",
                    run_id,
                    chat_id=chat_id,
                    reason="newer user message arrived while this message was waiting",
                    payload=_run_completed_payload(
                        "in_progress" if message_ids else "skipped",
                        message_ids,
                        message_texts,
                        tool_summary=tool_summary.model_dump(),
                    ),
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
            yield _emit(
                "message.persisted",
                run_id,
                chat_id=chat_id,
                message_id=response.message.id,
                text=response.message.text,
                payload=response.message.model_dump(mode="json"),
            )
            if response.message.is_delivered:
                yield _emit(
                    "message.delivered",
                    run_id,
                    chat_id=chat_id,
                    message_id=response.message.id,
                )
            if response.message.is_read:
                yield _emit(
                    "message.read",
                    run_id,
                    chat_id=chat_id,
                    message_id=response.message.id,
                )

        yield _emit(
            "run.completed",
            run_id,
            chat_id=chat_id,
            payload=_run_completed_payload(
                _derive_run_status(reasoner_output, tool_summary, message_texts),
                message_ids,
                message_texts,
                tool_summary=tool_summary.model_dump(),
            ),
        )
    except SandboxClientError as exc:
        yield _emit(
            "error",
            run_id,
            chat_id=chat_id,
            error=exc.message,
            payload={"status_code": exc.status_code},
        )
        yield _emit(
            "run.completed",
            run_id,
            chat_id=chat_id,
            reason=exc.message,
            payload=_run_completed_payload(
                "failed",
                status_code=exc.status_code,
            ),
        )
    except Exception as exc:
        error = f"agent_error: {exc}"
        yield _emit("error", run_id, chat_id=chat_id, error=error)
        yield _emit(
            "run.completed",
            run_id,
            chat_id=chat_id,
            reason=error,
            payload=_run_completed_payload("failed"),
        )


async def respond_to_chat(request: AgentRespondRequest) -> AgentRespondResponse:
    chat_id: str | None = request.chat_id
    last_reason: str | None = None
    message_ids: list[str] = []
    messages: list[str] = []
    status: AgentRunStatus = "skipped"

    async for event in stream_response_events(request):
        if event.chat_id is not None:
            chat_id = event.chat_id

        if event.type == "message.persisted":
            if event.message_id:
                message_ids.append(event.message_id)
            if event.text:
                messages.append(event.text)
            status = "message_sent"
        elif event.type == "run.completed":
            last_reason = event.reason
            if event.payload:
                status = event.payload.get("status", status)
                message_ids = event.payload.get("message_ids", message_ids)
                messages = event.payload.get("messages", messages)
        elif event.type == "error":
            status = "failed"
            last_reason = event.error or "agent_error"

    return AgentRespondResponse(
        chat_id=chat_id or "",
        status=status,
        messages=messages,
        message_ids=message_ids,
        reason=last_reason,
    )
