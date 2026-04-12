from config import settings
from schemas import SandboxMessage


def build_memory(messages: list[SandboxMessage]) -> str:
    recent_messages = messages[-settings.memory_window_size :]
    lines: list[str] = []

    for message in recent_messages:
        speaker = "me" if message.is_from_me else message.from_handle or "them"
        text = " ".join(message.text.split())
        if text:
            lines.append(f"{speaker}: {text}")

    return "\n".join(lines)
