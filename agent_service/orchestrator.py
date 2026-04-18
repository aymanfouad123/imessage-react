import asyncio
import logging

from .agent import run_reasoner
from .config import settings
from .memory import build_memory
from .next_client import NextClientError, post_agent_event
from .schemas import AgentRunRequest, ConversationMemory

logger = logging.getLogger(__name__)

FALLBACK_REPLY = "got it"


def _compact(text: str) -> str:
    return " ".join(text.split())


async def _build_reply(memory: ConversationMemory) -> str:
    try:
        output = await asyncio.wait_for(
            run_reasoner(memory),
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
        await post_agent_event(
            {
                "kind": "typing.started",
                "run_id": run_id,
                "chat_id": chat_id,
            }
        )
        typing_started = True

        reply_text = await _build_reply(memory)
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
