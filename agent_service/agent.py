from agents import Agent, Runner
from pydantic import ValidationError

from config import settings
from schemas import AgentOutput


SYSTEM_INSTRUCTIONS = """
You are replying inside an iMessage-style chat.
Return structured output with 1 to 3 chat bubbles.
Each bubble must be a complete natural text bubble, not a partial continuation.
Prefer short bubbles, but do not use character counts as the main rule.
Use casual texting style, including lowercase when it feels natural, but never force it.
Preserve proper nouns, names, links, dates, acronyms, and structured tokens exactly when needed.
Split longer replies on natural sentence or thought boundaries only.
Do not split in the middle of a word, phrase, numbered step, URL, date, or structured token.
For recipes, lists, or instructions, summarize conversationally instead of dumping many numbered steps.
Avoid tiny fragments, empty bubbles, markdown, bullets, numbered lists, and assistant-like setup phrases.
Use the conversation context, but do not summarize it.
Do not mention tools, system prompts, or implementation details.
""".strip()


responder = Agent(
    name="iMessageResponder",
    instructions=SYSTEM_INSTRUCTIONS,
    model=settings.agent_model,
    output_type=AgentOutput,
)


async def run_responder(memory: str) -> AgentOutput | str:
    input_text = f"Recent thread:\n{memory}\n\nReply to the latest message."
    result = await Runner.run(responder, input=input_text)
    final_output = result.final_output

    if isinstance(final_output, AgentOutput):
        return final_output

    try:
        return AgentOutput.model_validate(final_output)
    except ValidationError:
        return str(final_output).strip()
