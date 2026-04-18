import logging

from agents import Agent, Runner
from pydantic import ValidationError

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


def _preview(value: object, max_length: int = 500) -> str:
    text = str(value)
    if len(text) <= max_length:
        return text

    return f"{text[:max_length]}..."


def _log_reasoner_output(output: ReasonerOutput) -> None:
    logger.info(
        "reasoner.output should_reply=%s reason=%s draft_preview=%s",
        output.should_reply,
        output.reason,
        _preview(output.draft_response, 160),
    )


reasoner_agent = Agent(
    name="iMessageReasoner",
    instructions=REASONER_INSTRUCTIONS,
    model=settings.agent_model,
    output_type=ReasonerOutput,
)


async def run_reasoner(memory: ConversationMemory) -> ReasonerOutput:
    latest_text = memory.latest_user_message.text if memory.latest_user_message else ""
    input_text = "\n\n".join(
        [
            f"Recent thread:\n{format_memory(memory)}",
            f"Latest user message:\n{latest_text}",
            "Decide whether to reply. If replying, produce draft_response.",
        ]
    )
    logger.info("reasoner.run_started")
    result = await Runner.run(reasoner_agent, input=input_text)
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
