import asyncio
import logging

from .agent import run_reasoner
from .calendar_tools import (
    build_auth_reply,
    build_auth_unavailable_reply,
    create_calendar_auth_url,
    detect_calendar_intent,
    get_calendar_connection_status,
    is_calendar_enabled,
)
from .config import settings
from .memory import build_memory
from .next_client import NextClientError, post_agent_event
from .schemas import AgentRunRequest, ConversationMemory

logger = logging.getLogger(__name__)

FALLBACK_REPLY = "got it"


def _compact(text: str) -> str:
    return " ".join(text.split())


async def _build_reply(
    memory: ConversationMemory, *, use_calendar_tools: bool = False
) -> str:
    try:
        output = await asyncio.wait_for(
            run_reasoner(memory, use_calendar_tools=use_calendar_tools),
            timeout=settings.agent_reasoner_timeout_seconds,
        )
    except TimeoutError:
        logger.warning("reasoner timed out; using fallback reply")
        return FALLBACK_REPLY
    except Exception:
        logger.exception("reasoner failed; using fallback reply")
        return FALLBACK_REPLY

    if not output.should_reply:
        logger.info("reasoner requested no reply: %s", output.reason or "")

    return _compact(output.draft_response) or FALLBACK_REPLY


async def _resolve_calendar_reply(memory: ConversationMemory) -> str | None:
    """Return an auth reply when calendar intent needs Google Calendar access."""
    latest = memory.latest_user_message
    if latest is None:
        return None
    if not detect_calendar_intent(latest.text):
        return None
    if not is_calendar_enabled():
        logger.info("calendar intent detected but calendar access is disabled")
        return build_auth_unavailable_reply()

    status = get_calendar_connection_status()
    logger.info(
        "calendar intent detected toolkit=%s connected=%s",
        status.toolkit_slug,
        status.is_connected,
    )
    if status.is_connected:
        return None

    auth_url = create_calendar_auth_url()
    if not auth_url:
        return build_auth_unavailable_reply()
    return build_auth_reply(auth_url)


async def _stop_typing(run_id: str, chat_id: str) -> None:
    try:
        await post_agent_event(
            {
                "kind": "typing.stopped",
                "run_id": run_id,
                "chat_id": chat_id,
            }
        )
    except Exception:
        logger.exception("failed to stop typing run_id=%s", run_id)


async def _simulate_read_delay(run_id: str, chat_id: str) -> None:
    delay = settings.agent_read_delay_seconds
    if delay <= 0:
        return

    logger.info(
        "agent read delay started run_id=%s chat_id=%s seconds=%s",
        run_id,
        chat_id,
        delay,
    )
    await asyncio.sleep(delay)


async def execute_agent_run(request: AgentRunRequest) -> None:
    run_id = request.run_id
    chat_id = request.chat_id
    memory = build_memory(list(request.context.recent_messages))

    if memory.latest_user_message is None:
        logger.info(
            "agent run skipped run_id=%s chat_id=%s reason=no_user_message",
            run_id,
            chat_id,
        )
        return

    typing_started = False
    try:
        await _simulate_read_delay(run_id, chat_id)

        await post_agent_event(
            {
                "kind": "typing.started",
                "run_id": run_id,
                "chat_id": chat_id,
            }
        )
        typing_started = True

        auth_reply = await _resolve_calendar_reply(memory)
        if auth_reply:
            reply_text = auth_reply
        else:
            use_calendar_tools = (
                is_calendar_enabled()
                and detect_calendar_intent(memory.latest_user_message.text)
                and get_calendar_connection_status().is_connected
            )
            reply_text = await _build_reply(
                memory, use_calendar_tools=use_calendar_tools
            )

        await post_agent_event(
            {
                "kind": "agent.message",
                "run_id": run_id,
                "chat_id": chat_id,
                "text": reply_text,
                "sender_handle": request.context.agent_handle
                or settings.agent_sender_handle,
            }
        )
    except NextClientError as exc:
        logger.error("next_client_error: %s", exc.message)
    except Exception:
        logger.exception("execute_agent_run failed")
    finally:
        if typing_started:
            await _stop_typing(run_id, chat_id)
