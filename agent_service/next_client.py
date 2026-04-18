import logging
from typing import Any

import httpx

from .config import settings

logger = logging.getLogger(__name__)


class NextClientError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


_client: httpx.AsyncClient | None = None


async def startup() -> None:
    global _client
    if _client is not None:
        return
    _client = httpx.AsyncClient(
        base_url=settings.next_internal_base_url.rstrip("/"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.internal_agent_secret}",
        },
        timeout=httpx.Timeout(60.0),
    )


async def shutdown() -> None:
    global _client
    if _client is None:
        return
    await _client.aclose()
    _client = None


def _get_client() -> httpx.AsyncClient:
    if _client is None:
        raise NextClientError("next_client_not_started", 500)
    return _client


async def post_agent_event(payload: dict[str, Any]) -> None:
    if _client is None:
        await startup()
    try:
        response = await _get_client().post(
            "/api/internal/agent/events", json=payload
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text or exc.response.reason_phrase
        raise NextClientError(
            f"next_http_error {exc.response.status_code}: {detail}",
            status_code=exc.response.status_code,
        ) from exc
    except httpx.HTTPError as exc:
        raise NextClientError(f"next_unreachable: {exc}") from exc

