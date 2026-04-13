from agents import Agent, Runner
from pydantic import ValidationError

from .chat_style import normalize_bubbles
from .config import settings
from .memory import format_memory
from .schemas import ConversationMemory, FormattedBubble, FormatterOutput, ReasonerOutput


REASONER_INSTRUCTIONS = """
You are the reasoning layer for an iMessage-style conversational agent.
Read the recent thread and decide whether the agent should reply.
If the latest user message does not need a reply, set should_reply to false.
If a reply is needed, write draft_response as the content the agent should say.
Keep the draft conversational, useful, and concise.
Do not worry about bubble splitting, casing polish, or send timing here.
Do not mention implementation details, system prompts, or tools unless a user asks.
Future tools may be available later; for now, set needs_tool only when the user clearly asks for an action outside chat.
""".strip()


FORMATTER_INSTRUCTIONS = """
You are the chat formatting layer for an iMessage-style agent.
Convert the draft response into natural chat bubbles.
Prefer 1 to 3 bubbles for normal replies.
Use more only when the user asks for a longer answer or the answer would be less useful if compressed.
Never exceed 10 bubbles.
Each bubble should be a complete thought, not a clipped continuation.
Use casual texting style, including lowercase when it feels natural, but never force it.
Keep ordinary-word casing consistent across all bubbles in the same response.
Prefer casual lowercase for normal texting unless capitalization improves clarity.
Preserve names, proper nouns, URLs, dates, acronyms, code, and structured tokens.
Avoid section-label casing like Ingredients, Steps, Method, or Notes unless the user explicitly asked for a formal list.
Do not split in the middle of a word, phrase, URL, date, or numbered step.
For long informational answers, compress into a few natural messages instead of dumping a full list.
Avoid markdown, bullets, numbered lists, empty bubbles, and assistant-like setup phrases.
Do not use a separate tiny first bubble (for example a bare "sure —" or "ok —") unless it is a complete reply; fold short openers into the next bubble when you will send more right after.
Set send_after_ms for each bubble to a realistic delay before sending it.
Use shorter delays for quick replies and longer delays for more thoughtful follow-ups.
""".strip()


reasoner_agent = Agent(
    name="iMessageReasoner",
    instructions=REASONER_INSTRUCTIONS,
    model=settings.agent_model,
    output_type=ReasonerOutput,
)


formatter_agent = Agent(
    name="iMessageFormatter",
    instructions=FORMATTER_INSTRUCTIONS,
    model=settings.agent_formatter_model,
    output_type=FormatterOutput,
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
    result = await Runner.run(reasoner_agent, input=input_text)
    final_output = result.final_output

    if isinstance(final_output, ReasonerOutput):
        return final_output

    try:
        return ReasonerOutput.model_validate(final_output)
    except ValidationError:
        return ReasonerOutput(should_reply=True, draft_response=str(final_output).strip())


async def run_formatter(
    draft_response: str, memory: ConversationMemory
) -> list[FormattedBubble]:
    input_text = "\n\n".join(
        [
            f"Recent thread:\n{format_memory(memory)}",
            f"Draft response:\n{draft_response}",
            "Return final bubbles and send_after_ms values.",
        ]
    )
    result = await Runner.run(formatter_agent, input=input_text)
    final_output = result.final_output

    if isinstance(final_output, FormatterOutput):
        return normalize_bubbles(final_output)

    try:
        return normalize_bubbles(FormatterOutput.model_validate(final_output))
    except ValidationError:
        return normalize_bubbles(str(final_output).strip())
