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


def _get_bool(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    return raw_value.lower() in {"1", "true", "yes", "on"}


def _get_float(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        value = float(raw_value)
    except ValueError:
        return default

    return value if value > 0 else default


@dataclass(frozen=True)
class Settings:
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    agent_model: str = os.getenv("AGENT_MODEL", "gpt-5.4-mini")
    next_internal_base_url: str = os.getenv(
        "NEXT_INTERNAL_BASE_URL", "http://127.0.0.1:3000"
    )
    internal_agent_secret: str = os.getenv(
        "INTERNAL_AGENT_SECRET", "dev-internal-agent-secret"
    )
    agent_sender_handle: str = os.getenv("AGENT_SENDER_HANDLE", "Pepper")
    agent_reasoner_timeout_seconds: float = _get_float(
        "AGENT_REASONER_TIMEOUT_SECONDS", 90.0
    )
    agent_read_delay_seconds: float = _get_float(
        "AGENT_READ_DELAY_SECONDS", 1.25
    )
    memory_window_size: int = _get_int("MEMORY_WINDOW_SIZE", 20)
    composio_enabled: bool = _get_bool("COMPOSIO_ENABLED", True)
    composio_user_id: str = os.getenv("COMPOSIO_USER_ID", "user_xgge7l")
    composio_required_toolkits: str = os.getenv(
        "COMPOSIO_REQUIRED_TOOLKITS", "googlecalendar"
    )
    composio_manage_connections: bool = _get_bool("COMPOSIO_MANAGE_CONNECTIONS", True)


settings = Settings()
