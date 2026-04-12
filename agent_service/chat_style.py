import json
from typing import Any

from pydantic import ValidationError

from config import settings
from schemas import FormattedBubble, FormatterOutput


MAX_BUBBLES = 10
FALLBACK_MAX_CHARS = 1000
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


def clamp_delay_ms(delay_ms: int | None, text: str, index: int) -> int:
    if delay_ms is None:
        if index == 0:
            seconds = settings.agent_first_bubble_delay_seconds
            seconds = max(seconds, settings.agent_min_bubble_delay_seconds)
            seconds = min(seconds, settings.agent_max_bubble_delay_seconds)
            return int(seconds * 1000)
        else:
            chars_per_second = max(settings.agent_typing_chars_per_second, 1)
            seconds = len(text) / chars_per_second
    else:
        seconds = delay_ms / 1000

    seconds = max(seconds, settings.agent_min_bubble_delay_seconds)
    seconds = min(seconds, settings.agent_max_bubble_delay_seconds)
    return int(seconds * 1000)


def _merge_overflow(bubbles: list[FormattedBubble]) -> list[FormattedBubble]:
    cleaned = [
        FormattedBubble(text=_compact(bubble.text), send_after_ms=bubble.send_after_ms)
        for bubble in bubbles
        if _compact(bubble.text)
    ]
    if not cleaned:
        return [FormattedBubble(text=FALLBACK_TEXT)]

    if len(cleaned) > MAX_BUBBLES:
        head = cleaned[: MAX_BUBBLES - 1]
        tail_text = _compact(" ".join(bubble.text for bubble in cleaned[MAX_BUBBLES - 1 :]))
        tail_delay = cleaned[MAX_BUBBLES - 1].send_after_ms
        cleaned = [*head, FormattedBubble(text=tail_text, send_after_ms=tail_delay)]

    normalized: list[FormattedBubble] = []
    for index, bubble in enumerate(cleaned):
        text = _trim_to_limit(bubble.text)
        if text:
            normalized.append(
                FormattedBubble(
                    text=text,
                    send_after_ms=clamp_delay_ms(bubble.send_after_ms, text, index),
                )
            )

    return normalized or [FormattedBubble(text=FALLBACK_TEXT)]


def _coerce_formatter_output(output: Any) -> FormatterOutput | None:
    if isinstance(output, FormatterOutput):
        return output

    try:
        return FormatterOutput.model_validate(output)
    except ValidationError:
        return None


def _coerce_json_output(output: str) -> FormatterOutput | None:
    try:
        parsed_output = json.loads(output)
    except json.JSONDecodeError:
        return None

    return _coerce_formatter_output(parsed_output)


def normalize_bubbles(output: Any) -> list[FormattedBubble]:
    formatter_output = _coerce_formatter_output(output)
    if formatter_output is not None:
        return _merge_overflow(formatter_output.bubbles)

    if isinstance(output, str):
        formatter_output = _coerce_json_output(output)
        if formatter_output is not None:
            return _merge_overflow(formatter_output.bubbles)

        fallback = _trim_to_limit(output)
        return _merge_overflow([FormattedBubble(text=fallback or FALLBACK_TEXT)])

    if isinstance(output, list):
        bubbles = [
            item
            if isinstance(item, FormattedBubble)
            else FormattedBubble(text=str(item))
            for item in output
        ]
        return _merge_overflow(bubbles)

    fallback = _trim_to_limit(str(output))
    return _merge_overflow([FormattedBubble(text=fallback or FALLBACK_TEXT)])
