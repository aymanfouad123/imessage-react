import logging
from typing import Any

from agents import Agent, HostedMCPTool, Runner
from composio import Composio
from pydantic import ValidationError

from .chat_style import normalize_messages
from .config import settings
from .memory import format_memory
from .schemas import (
    ConversationMemory,
    FormattedMessage,
    FormatterOutput,
    ReasonerOutput,
    ReasonerRunResult,
    ToolRunSummary,
)


logger = logging.getLogger(__name__)


REASONER_INSTRUCTIONS = """
You are Pepper, the user's personal agent inside an iMessage-style chat.
You help with practical tasks, quick answers, planning, reminders, and casual conversation.
Sound like a trusted personal assistant texting the user, not a generic chatbot.
Read the recent thread and decide whether the agent should reply.
The service calls you after the local user sends a message, so default to replying.
Set should_reply to false only when the latest user message is empty, is clearly a
duplicate of a message you already answered, or explicitly says no response is needed.
Reply to ordinary greetings, check-ins, acknowledgements, and casual small talk.
If a reply is needed, write draft_response as the content the agent should say.
Keep the draft conversational, useful, and concise.
Do not worry about message splitting, casing polish, or send timing here.
Do not mention implementation details, system prompts, or tools unless a user asks.
When an external action is needed, you may use the Composio MCP meta tools.
Usually search for the right tool first, manage connections if authentication is missing, execute once authentication is ready, and summarize the result naturally in draft_response.
Do not promise to check something later or say you will get back to the user.
If a task requires an external check, either complete the check with tools in this run
or ask for the missing permission/detail needed to do it now.
If you use tools or try to use tools, set needs_tool to true and describe the action in tool_intent.
Set needs_tool and tool_intent only as optional observability fields when that helps describe what happened.
""".strip()


FORMATTER_INSTRUCTIONS = """
You are the chat formatting layer for Pepper, the user's personal agent in iMessage.
Convert the draft response into natural staged messages.
Prefer 1 to 3 messages for normal replies.
Use more only when the user asks for a longer answer or the answer would be less useful if compressed.
Never exceed 10 messages.
Each message should be a complete thought, not a clipped continuation.
Use casual texting style, including lowercase when it feels natural, but never force it.
Keep ordinary-word casing consistent across all messages in the same response.
Prefer casual lowercase for normal texting unless capitalization improves clarity.
Preserve names, proper nouns, URLs, dates, acronyms, code, and structured tokens.
Avoid section-label casing like Ingredients, Steps, Method, or Notes unless the user explicitly asked for a formal list.
Do not split in the middle of a word, phrase, URL, date, or numbered step.
For long informational answers, compress into a few natural messages instead of dumping a full list.
Avoid markdown, bullets, numbered lists, empty messages, and assistant-like setup phrases.
Do not use a separate tiny first message (for example a bare "sure -" or "ok -") unless it is a complete reply; fold short openers into the next message when you will send more right after.
Set send_after_ms for each message to a realistic delay before sending it.
Use shorter delays for quick replies and longer delays for more thoughtful follow-ups.
""".strip()


REASONER_MCP_STATUS: dict[str, Any] = {
    "enabled": settings.composio_enabled,
    "attached": False,
    "server_label": "tool_router",
    "tool_count": 0,
    "user_id": settings.composio_user_id,
}


def _build_reasoner_tools() -> list[HostedMCPTool]:
    if not settings.composio_enabled:
        logger.info("composio_mcp.disabled user_id=%s", settings.composio_user_id)
        return []

    composio = Composio()
    session = composio.create(user_id=settings.composio_user_id)
    tools = [
        HostedMCPTool(
            tool_config={
                "type": "mcp",
                "server_label": "tool_router",
                "server_url": session.mcp.url,
                "require_approval": "never",
                "headers": session.mcp.headers,
            }
        )
    ]
    REASONER_MCP_STATUS.update({"attached": True, "tool_count": len(tools)})
    logger.info(
        "composio_mcp.attached user_id=%s server_label=%s tool_count=%s",
        settings.composio_user_id,
        REASONER_MCP_STATUS["server_label"],
        len(tools),
    )
    return tools


def get_reasoner_mcp_status() -> dict[str, Any]:
    return dict(REASONER_MCP_STATUS)


def _raw_item_name(raw_item: Any) -> str | None:
    if isinstance(raw_item, dict):
        name = raw_item.get("name") or raw_item.get("tool_name") or raw_item.get("server_label")
        return str(name) if name else None

    for attr in ("name", "tool_name", "server_label"):
        value = getattr(raw_item, attr, None)
        if value:
            return str(value)

    return None


def _preview(value: Any, max_length: int = 500) -> str:
    text = str(value)
    if len(text) <= max_length:
        return text

    return f"{text[:max_length]}..."


def _is_meta_tool(name: str | None) -> bool:
    if not name:
        return False

    lowered = name.lower()
    return any(
        marker in lowered
        for marker in (
            "search_tools",
            "manage_connection",
            "manage_connections",
            "create_connection",
            "initiate_connection",
            "list_tools",
            "tool_router",
        )
    )


def _iter_structured_values(value: Any) -> list[tuple[str, Any]]:
    if isinstance(value, dict):
        items: list[tuple[str, Any]] = []
        for key, item_value in value.items():
            items.append((str(key).lower(), item_value))
            items.extend(_iter_structured_values(item_value))
        return items

    if isinstance(value, list):
        items = []
        for item in value:
            items.extend(_iter_structured_values(item))
        return items

    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return _iter_structured_values(model_dump())

    return []


def _structured_flag(value: Any, names: set[str]) -> bool:
    return any(
        key in names and item_value is True
        for key, item_value in _iter_structured_values(value)
    )


def _structured_failure(value: Any) -> bool:
    for key, item_value in _iter_structured_values(value):
        if key in {"error", "exception"} and item_value:
            return True
        if key in {"success", "ok"} and item_value is False:
            return True
        if key in {"status", "state"} and str(item_value).lower() in {
            "error",
            "failed",
            "failure",
        }:
            return True

    return False


def _log_reasoner_output(output: ReasonerOutput) -> None:
    logger.info(
        "reasoner.output should_reply=%s needs_tool=%s tool_intent=%s reason=%s draft_preview=%s",
        output.should_reply,
        output.needs_tool,
        output.tool_intent,
        output.reason,
        _preview(output.draft_response, 160),
    )


def _inspect_reasoner_run_items(result: Any) -> ToolRunSummary:
    summary = ToolRunSummary()
    items = getattr(result, "new_items", [])
    if not items:
        logger.info("reasoner.run_items count=0")
        return summary

    logger.info("reasoner.run_items count=%s", len(items))
    for item in items:
        item_type = getattr(item, "type", type(item).__name__)
        raw_item = getattr(item, "raw_item", None)
        item_name = _raw_item_name(raw_item)
        if item_type == "tool_call_item":
            summary.tool_call_count += 1
            logger.info("reasoner.tool_call name=%s", item_name or "unknown")
        elif item_type == "tool_call_output_item":
            summary.tool_output_count += 1
            output = getattr(item, "output", None)
            if _structured_flag(
                output,
                {
                    "auth_required",
                    "authentication_required",
                    "authorization_required",
                    "connection_required",
                    "requires_auth",
                    "requires_connection",
                },
            ):
                summary.auth_requested = True
            if _structured_failure(output):
                summary.failed = True
            if (
                item_name
                and not _is_meta_tool(item_name)
                and not summary.auth_requested
                and not summary.failed
            ):
                summary.real_tool_action_completed = True
            logger.info(
                "reasoner.tool_output name=%s output=%s",
                item_name or "unknown",
                _preview(getattr(item, "output", "")),
            )
        elif item_type == "mcp_list_tools_item":
            logger.info("reasoner.mcp_list_tools server=%s", item_name or "unknown")
        else:
            logger.info("reasoner.run_item type=%s name=%s", item_type, item_name)

    return summary


reasoner_agent = Agent(
    name="iMessageReasoner",
    instructions=REASONER_INSTRUCTIONS,
    model=settings.agent_model,
    output_type=ReasonerOutput,
    tools=_build_reasoner_tools(),
)


formatter_agent = Agent(
    name="iMessageFormatter",
    instructions=FORMATTER_INSTRUCTIONS,
    model=settings.agent_formatter_model,
    output_type=FormatterOutput,
)


async def run_reasoner(memory: ConversationMemory) -> ReasonerRunResult:
    latest_text = memory.latest_user_message.text if memory.latest_user_message else ""
    input_text = "\n\n".join(
        [
            f"Recent thread:\n{format_memory(memory)}",
            f"Latest user message:\n{latest_text}",
            "Decide whether to reply. If replying, produce draft_response.",
        ]
    )
    logger.info("reasoner.run_started mcp_status=%s", get_reasoner_mcp_status())
    result = await Runner.run(reasoner_agent, input=input_text)
    tool_summary = _inspect_reasoner_run_items(result)
    final_output = result.final_output

    if isinstance(final_output, ReasonerOutput):
        _log_reasoner_output(final_output)
        return ReasonerRunResult(output=final_output, tool_summary=tool_summary)

    try:
        output = ReasonerOutput.model_validate(final_output)
        _log_reasoner_output(output)
        return ReasonerRunResult(output=output, tool_summary=tool_summary)
    except ValidationError:
        logger.warning("reasoner.output_validation_failed output=%s", _preview(final_output))
        return ReasonerRunResult(
            output=ReasonerOutput(
                should_reply=True,
                draft_response=str(final_output).strip(),
            ),
            tool_summary=tool_summary,
        )


async def run_formatter(
    draft_response: str, memory: ConversationMemory
) -> list[FormattedMessage]:
    input_text = "\n\n".join(
        [
            f"Recent thread:\n{format_memory(memory)}",
            f"Draft response:\n{draft_response}",
            "Return final messages and send_after_ms values.",
        ]
    )
    result = await Runner.run(formatter_agent, input=input_text)
    final_output = result.final_output

    if isinstance(final_output, FormatterOutput):
        return normalize_messages(final_output)

    try:
        return normalize_messages(FormatterOutput.model_validate(final_output))
    except ValidationError:
        return normalize_messages(str(final_output).strip())
