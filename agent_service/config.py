import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parent / ".env")


def _get_int(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        value = int(raw_value)
    except ValueError:
        return default

    return value if value > 0 else default


def _get_float(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        value = float(raw_value)
    except ValueError:
        return default

    return value if value > 0 else default


def _get_bool(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    return raw_value.lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    agent_model: str = os.getenv("AGENT_MODEL", "gpt-5.4-mini")
    agent_formatter_model: str = os.getenv("AGENT_FORMATTER_MODEL", "gpt-5.4-mini")
    composio_enabled: bool = _get_bool("COMPOSIO_ENABLED", True)
    composio_user_id: str = os.getenv("COMPOSIO_USER_ID", "test_demo")
    sandbox_base_url: str = os.getenv("SANDBOX_BASE_URL", "http://localhost:3000")
    agent_sender_handle: str = os.getenv("AGENT_SENDER_HANDLE", "Pepper")
    agent_reasoner_timeout_seconds: float = _get_float(
        "AGENT_REASONER_TIMEOUT_SECONDS", 90.0
    )
    agent_formatter_timeout_seconds: float = _get_float(
        "AGENT_FORMATTER_TIMEOUT_SECONDS", 30.0
    )
    agent_task_update_interval_seconds: float = _get_float(
        "AGENT_TASK_UPDATE_INTERVAL_SECONDS", 5.0
    )
    memory_window_size: int = _get_int("MEMORY_WINDOW_SIZE", 20)
    agent_enable_idempotency: bool = (
        os.getenv("AGENT_ENABLE_IDEMPOTENCY", "true").lower() == "true"
    )
    agent_first_message_delay_seconds: float = float(
        os.getenv("AGENT_FIRST_MESSAGE_DELAY_SECONDS", "1.2")
    )
    agent_min_message_delay_seconds: float = float(
        os.getenv("AGENT_MIN_MESSAGE_DELAY_SECONDS", "0.7")
    )
    agent_max_message_delay_seconds: float = float(
        os.getenv("AGENT_MAX_MESSAGE_DELAY_SECONDS", "2.2")
    )
    agent_typing_chars_per_second: float = float(
        os.getenv("AGENT_TYPING_CHARS_PER_SECOND", "32")
    )
    agent_delay_jitter_max_seconds: float = float(
        os.getenv("AGENT_DELAY_JITTER_MAX_SECONDS", "0.35")
    )
    agent_typing_lead_seconds: float = float(
        os.getenv("AGENT_TYPING_LEAD_SECONDS", "1.0")
    )
    # Message chunks shorter than this merge into a neighbor so quick setup
    # lines do not sit alone before a longer reply.
    agent_min_message_chars: int = _get_int("AGENT_MIN_MESSAGE_CHARS", 28)


settings = Settings()
