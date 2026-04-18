import json
from typing import Any

from pydantic import ValidationError

from .config import settings
from .schemas import FormattedMessage, FormatterOutput


MAX_MESSAGES = 10
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
            seconds = settings.agent_first_message_delay_seconds
            seconds = max(seconds, settings.agent_min_message_delay_seconds)
            seconds = min(seconds, settings.agent_max_message_delay_seconds)
            return int(seconds * 1000)
        else:
            chars_per_second = max(settings.agent_typing_chars_per_second, 1)
            seconds = len(text) / chars_per_second
    else:
        seconds = delay_ms / 1000

    seconds = max(seconds, settings.agent_min_message_delay_seconds)
    seconds = min(seconds, settings.agent_max_message_delay_seconds)
    return int(seconds * 1000)


def _merge_short_messages(
    messages: list[FormattedMessage], min_chars: int
) -> list[FormattedMessage]:
    """Merge very short chunks into a neighbor so setup lines do not stand alone."""
    if min_chars <= 0 or len(messages) <= 1:
        return messages

    merged: list[FormattedMessage] = []
    i = 0
    while i < len(messages):
        message = messages[i]
        text_len = len(_compact(message.text))
        if text_len < min_chars and i + 1 < len(messages):
            next_message = messages[i + 1]
            combined = _compact(f"{message.text} {next_message.text}")
            merged.append(
                FormattedMessage(text=combined, send_after_ms=next_message.send_after_ms)
            )
            i += 2
        elif text_len < min_chars and merged:
            prev = merged.pop()
            combined = _compact(f"{prev.text} {message.text}")
            merged.append(
                FormattedMessage(text=combined, send_after_ms=message.send_after_ms)
            )
            i += 1
        else:
            merged.append(message)
            i += 1
    return merged


def _merge_overflow(messages: list[FormattedMessage]) -> list[FormattedMessage]:
    cleaned = [
        FormattedMessage(
            text=_compact(message.text), send_after_ms=message.send_after_ms
        )
        for message in messages
        if _compact(message.text)
    ]
    if not cleaned:
        return [FormattedMessage(text=FALLBACK_TEXT)]

    if len(cleaned) > MAX_MESSAGES:
        head = cleaned[: MAX_MESSAGES - 1]
        tail_text = _compact(
            " ".join(message.text for message in cleaned[MAX_MESSAGES - 1 :])
        )
        tail_delay = cleaned[MAX_MESSAGES - 1].send_after_ms
        cleaned = [*head, FormattedMessage(text=tail_text, send_after_ms=tail_delay)]

    cleaned = _merge_short_messages(cleaned, settings.agent_min_message_chars)

    normalized: list[FormattedMessage] = []
    for index, message in enumerate(cleaned):
        text = _trim_to_limit(message.text)
        if text:
            normalized.append(
                FormattedMessage(
                    text=text,
                    send_after_ms=clamp_delay_ms(message.send_after_ms, text, index),
                )
            )

    return normalized or [FormattedMessage(text=FALLBACK_TEXT)]


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


def normalize_messages(output: Any) -> list[FormattedMessage]:
    formatter_output = _coerce_formatter_output(output)
    if formatter_output is not None:
        return _merge_overflow(formatter_output.messages)

    if isinstance(output, str):
        formatter_output = _coerce_json_output(output)
        if formatter_output is not None:
            return _merge_overflow(formatter_output.messages)

        fallback = _trim_to_limit(output)
        return _merge_overflow([FormattedMessage(text=fallback or FALLBACK_TEXT)])

    if isinstance(output, list):
        messages = [
            item
            if isinstance(item, FormattedMessage)
            else FormattedMessage(text=str(item))
            for item in output
        ]
        return _merge_overflow(messages)

    fallback = _trim_to_limit(str(output))
    return _merge_overflow([FormattedMessage(text=fallback or FALLBACK_TEXT)])
