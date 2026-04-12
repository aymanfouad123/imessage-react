from config import settings
from schemas import ConversationMemory, MemoryMessage, SandboxMessage


def _to_memory_message(message: SandboxMessage) -> MemoryMessage:
    if message.is_from_me:
        sender_type = "user"
        sender = "me"
    elif message.from_handle == settings.agent_sender_handle:
        sender_type = "agent"
        sender = settings.agent_sender_handle
    else:
        sender_type = "agent"
        sender = message.from_handle or "them"

    return MemoryMessage(
        id=message.id,
        sender_type=sender_type,
        sender=sender,
        text=" ".join(message.text.split()),
        created_at=message.created_at,
    )


def build_memory(messages: list[SandboxMessage]) -> ConversationMemory:
    recent_messages = [
        memory_message
        for message in messages[-settings.memory_window_size :]
        if (memory_message := _to_memory_message(message)).text
    ]

    latest_user_message = next(
        (
            message
            for message in reversed(recent_messages)
            if message.sender_type == "user"
        ),
        None,
    )
    latest_agent_message = next(
        (
            message
            for message in reversed(recent_messages)
            if message.sender_type == "agent"
        ),
        None,
    )

    return ConversationMemory(
        messages=recent_messages,
        latest_user_message=latest_user_message,
        latest_agent_message=latest_agent_message,
    )


def format_memory(memory: ConversationMemory) -> str:
    return "\n".join(
        f"{message.sender}: {message.text}" for message in memory.messages
    )
