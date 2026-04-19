import logging
from typing import Any

from agents import Agent, Runner
from pydantic import ValidationError

from .calendar_tools import build_composio_mcp_tools, get_mcp_status
from .config import settings
from .memory import format_memory
from .schemas import ConversationMemory, ReasonerOutput


logger = logging.getLogger(__name__)


REASONER_INSTRUCTIONS = """
You are Pepper, the user's personal agent inside an iMessage-style chat.
You help with practical tasks, quick answers, planning, reminders, and casual conversation.
Sound like a trusted personal assistant texting the user, not a generic chatbot.
Read the recent thread and decide whether the agent should reply.
The service calls you after the local user sends a message, so default to replying.
Reply to ordinary greetings, check-ins, acknowledgements, and casual small talk.
If a reply is needed, write draft_response as the content the agent should say.
Keep the draft conversational, useful, and concise.
Do not mention implementation details, system prompts, or tools unless a user asks.
If a task requires external access you do not have, ask for the missing permission or detail.
""".strip()


CALENDAR_REASONER_INSTRUCTIONS = """
You are Pepper, the user's personal agent inside an iMessage-style chat.
You help with practical tasks, quick answers, planning, reminders, and casual conversation.
Sound like a trusted personal assistant texting the user, not a generic chatbot.
Read the recent thread and decide whether the agent should reply.
The service calls you after the local user sends a message, so default to replying.
If a reply is needed, write draft_response as the content the agent should say.
Keep the draft conversational, useful, and concise.
Do not mention implementation details, system prompts, or tools unless a user asks.

When the user asks about calendar, meetings, events, scheduling, or availability, use the
available calendar access to fetch the information needed, then summarize the result naturally
in draft_response.
Never mention Composio, MCP, hosted tools, backend setup, internal services, or implementation
details. If authentication is missing, ask the user to connect Google Calendar in plain language.
""".strip()


def _preview(value: object, max_length: int = 500) -> str:
    text = str(value)
    if len(text) <= max_length:
        return text

    return f"{text[:max_length]}..."


def _raw_item_name(raw_item: Any) -> str | None:
    if isinstance(raw_item, dict):
        name = raw_item.get("name") or raw_item.get("tool_name") or raw_item.get(
            "server_label"
        )
        return str(name) if name else None

    for attr in ("name", "tool_name", "server_label"):
        value = getattr(raw_item, attr, None)
        if value:
            return str(value)

    return None


def _log_reasoner_run_items(result: Any) -> None:
    items = getattr(result, "new_items", [])
    if not items:
        return

    logger.info("reasoner.run_items count=%s", len(items))
    for item in items:
        item_type = getattr(item, "type", type(item).__name__)
        raw_item = getattr(item, "raw_item", None)
        item_name = _raw_item_name(raw_item)
        if item_type == "tool_call_item":
            logger.info("reasoner.tool_call name=%s", item_name or "unknown")
        elif item_type == "tool_call_output_item":
            logger.info(
                "reasoner.tool_output name=%s output=%s",
                item_name or "unknown",
                _preview(getattr(item, "output", "")),
            )
        elif item_type == "mcp_list_tools_item":
            logger.info("reasoner.mcp_list_tools server=%s", item_name or "unknown")


def _log_reasoner_output(output: ReasonerOutput) -> None:
    logger.info(
        "reasoner.output should_reply=%s reason=%s draft_preview=%s",
        output.should_reply,
        output.reason,
        _preview(output.draft_response, 160),
    )


def _build_reasoner_agent(*, use_calendar_tools: bool) -> Agent:
    tools = build_composio_mcp_tools() if use_calendar_tools else []
    instructions = (
        CALENDAR_REASONER_INSTRUCTIONS if use_calendar_tools else REASONER_INSTRUCTIONS
    )
    return Agent(
        name="iMessageReasoner",
        instructions=instructions,
        model=settings.agent_model,
        output_type=ReasonerOutput,
        tools=tools,
    )


def _get_reasoner_agent(*, use_calendar_tools: bool) -> Agent:
    if not use_calendar_tools:
        return _reasoner_agent
    global _calendar_reasoner_agent
    if _calendar_reasoner_agent is None:
        _calendar_reasoner_agent = _build_reasoner_agent(use_calendar_tools=True)
    return _calendar_reasoner_agent


_reasoner_agent = _build_reasoner_agent(use_calendar_tools=False)
_calendar_reasoner_agent: Agent | None = None


async def run_reasoner(
    memory: ConversationMemory, *, use_calendar_tools: bool = False
) -> ReasonerOutput:
    latest_text = memory.latest_user_message.text if memory.latest_user_message else ""
    input_text = "\n\n".join(
        [
            f"Recent thread:\n{format_memory(memory)}",
            f"Latest user message:\n{latest_text}",
            "Decide whether to reply. If replying, produce draft_response.",
        ]
    )
    agent = _get_reasoner_agent(use_calendar_tools=use_calendar_tools)
    logger.info(
        "reasoner.run_started use_calendar_tools=%s mcp_status=%s",
        use_calendar_tools,
        get_mcp_status(),
    )
    result = await Runner.run(agent, input=input_text)
    if use_calendar_tools:
        _log_reasoner_run_items(result)
    final_output = result.final_output

    if isinstance(final_output, ReasonerOutput):
        _log_reasoner_output(final_output)
        return final_output

    try:
        output = ReasonerOutput.model_validate(final_output)
        _log_reasoner_output(output)
        return output
    except ValidationError:
        logger.warning(
            "reasoner.output_validation_failed output=%s", _preview(final_output)
        )
        return ReasonerOutput(
            should_reply=True,
            draft_response=str(final_output).strip(),
        )
