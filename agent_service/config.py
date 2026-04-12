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


@dataclass(frozen=True)
class Settings:
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    agent_model: str = os.getenv("AGENT_MODEL", "gpt-5.4-mini")
    agent_formatter_model: str = os.getenv("AGENT_FORMATTER_MODEL", "gpt-5.4-mini")
    sandbox_base_url: str = os.getenv("SANDBOX_BASE_URL", "http://localhost:3000")
    agent_sender_handle: str = os.getenv("AGENT_SENDER_HANDLE", "John Doe")
    memory_window_size: int = _get_int("MEMORY_WINDOW_SIZE", 20)
    agent_enable_idempotency: bool = (
        os.getenv("AGENT_ENABLE_IDEMPOTENCY", "true").lower() == "true"
    )
    agent_first_bubble_delay_seconds: float = float(
        os.getenv("AGENT_FIRST_BUBBLE_DELAY_SECONDS", "1.2")
    )
    agent_min_bubble_delay_seconds: float = float(
        os.getenv("AGENT_MIN_BUBBLE_DELAY_SECONDS", "0.7")
    )
    agent_max_bubble_delay_seconds: float = float(
        os.getenv("AGENT_MAX_BUBBLE_DELAY_SECONDS", "2.2")
    )
    agent_typing_chars_per_second: float = float(
        os.getenv("AGENT_TYPING_CHARS_PER_SECOND", "32")
    )
    agent_delay_jitter_max_seconds: float = float(
        os.getenv("AGENT_DELAY_JITTER_MAX_SECONDS", "0.35")
    )


settings = Settings()
