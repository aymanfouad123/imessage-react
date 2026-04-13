from typing import Any

import httpx
from pydantic import ValidationError

from .config import settings
from .schemas import (
    SandboxChat,
    SandboxChatResponse,
    SandboxListChatsResponse,
    SandboxMessagesResponse,
    SandboxReadChatResponse,
    SandboxSendMessageRequest,
    SandboxSendMessageResponse,
)


class SandboxClientError(Exception):
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
        base_url=settings.sandbox_base_url.rstrip("/"),
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        timeout=httpx.Timeout(10.0),
    )


async def shutdown() -> None:
    global _client
    if _client is None:
        return

    await _client.aclose()
    _client = None


def _get_client() -> httpx.AsyncClient:
    if _client is None:
        raise SandboxClientError("sandbox_client_not_started", 500)

    return _client


def _extract_error_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return response.text or response.reason_phrase

    if isinstance(data, dict):
        detail = data.get("error") or data.get("detail")
        if detail:
            return str(detail)

    return response.text or response.reason_phrase


async def _request_json(
    method: str, path: str, payload: dict[str, Any] | None = None
) -> Any:
    if _client is None:
        await startup()

    try:
        response = await _get_client().request(method, path, json=payload)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        detail = _extract_error_detail(exc.response)
        raise SandboxClientError(
            f"sandbox_http_error {status_code}: {detail}", status_code=status_code
        ) from exc
    except httpx.TimeoutException as exc:
        raise SandboxClientError("sandbox_timeout") from exc
    except httpx.HTTPError as exc:
        raise SandboxClientError(f"sandbox_unreachable: {exc}") from exc

    if not response.content:
        return {}

    try:
        return response.json()
    except ValueError as exc:
        raise SandboxClientError("sandbox returned invalid JSON") from exc


async def _request_model(
    model_type: type[Any], method: str, path: str, payload: dict[str, Any] | None = None
) -> Any:
    data = await _request_json(method, path, payload)
    try:
        return model_type.model_validate(data)
    except ValidationError as exc:
        raise SandboxClientError("sandbox returned an unexpected response shape") from exc


async def list_chats() -> list[SandboxChat]:
    response = await _request_model(SandboxListChatsResponse, "GET", "/api/chats")
    return response.chats


async def get_chat(chat_id: str) -> SandboxChat:
    response = await _request_model(SandboxChatResponse, "GET", f"/api/chats/{chat_id}")
    return response.chat


async def get_messages(chat_id: str):
    response = await _request_model(
        SandboxMessagesResponse, "GET", f"/api/chats/{chat_id}/messages"
    )
    return response.messages


async def send_message(chat_id: str, payload: SandboxSendMessageRequest):
    response = await _request_model(
        SandboxSendMessageResponse,
        "POST",
        f"/api/chats/{chat_id}/messages",
        payload.model_dump(exclude_none=True),
    )
    return response


async def mark_chat_read(chat_id: str):
    response = await _request_model(
        SandboxReadChatResponse, "POST", f"/api/chats/{chat_id}/read"
    )
    return response


async def find_default_agent_chat() -> SandboxChat:
    for chat in await list_chats():
        if chat.is_agent_chat is True:
            return chat

    raise SandboxClientError("no sandbox chat is seeded with is_agent_chat: true", 500)
