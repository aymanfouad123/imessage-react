import json
from typing import Any

from pydantic import ValidationError

from schemas import AgentChatBubble, AgentOutput


MAX_BUBBLES = 3
FALLBACK_MAX_CHARS = 800
FALLBACK_TEXT = "got it"


def _compact(text: str) -> str:
    return " ".join(text.split())


def _trim_to_limit(text: str) -> str:
    cleaned = _compact(text)
    if len(cleaned) <= FALLBACK_MAX_CHARS:
        return cleaned

    clipped = cleaned[: FALLBACK_MAX_CHARS - 1].rstrip()
    if " " not in clipped:
        return clipped

    return clipped.rsplit(" ", 1)[0].rstrip()


def _merge_overflow(bubbles: list[str]) -> list[str]:
    cleaned = [_compact(bubble) for bubble in bubbles if _compact(bubble)]
    if not cleaned:
        return [FALLBACK_TEXT]

    if len(cleaned) > MAX_BUBBLES:
        head = cleaned[: MAX_BUBBLES - 1]
        tail = _compact(" ".join(cleaned[MAX_BUBBLES - 1 :]))
        cleaned = [*head, tail] if tail else head

    safe_bubbles = [_trim_to_limit(bubble) for bubble in cleaned]
    return [bubble for bubble in safe_bubbles if bubble] or [FALLBACK_TEXT]


def _coerce_agent_output(output: Any) -> AgentOutput | None:
    if isinstance(output, AgentOutput):
        return output

    try:
        return AgentOutput.model_validate(output)
    except ValidationError:
        return None


def _coerce_json_output(output: str) -> AgentOutput | None:
    try:
        parsed_output = json.loads(output)
    except json.JSONDecodeError:
        return None

    return _coerce_agent_output(parsed_output)


def normalize_bubbles(output: Any) -> list[str]:
    structured_output = _coerce_agent_output(output)
    if structured_output is not None:
        return _merge_overflow([bubble.text for bubble in structured_output.bubbles])

    if isinstance(output, str):
        structured_output = _coerce_json_output(output)
        if structured_output is not None:
            return _merge_overflow([bubble.text for bubble in structured_output.bubbles])

        fallback = _trim_to_limit(output)
        return [fallback] if fallback else [FALLBACK_TEXT]

    if isinstance(output, list):
        bubbles = [
            item.text if isinstance(item, AgentChatBubble) else str(item)
            for item in output
        ]
        return _merge_overflow(bubbles)

    fallback = _trim_to_limit(str(output))
    return [fallback] if fallback else [FALLBACK_TEXT]
