import asyncio
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from config import settings
from schemas import (
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


def _sandbox_url(path: str) -> str:
    base_url = settings.sandbox_base_url.rstrip("/") + "/"
    return urljoin(base_url, path.lstrip("/"))


def _request_json(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        _sandbox_url(path),
        data=body,
        method=method,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )

    try:
        with urlopen(request, timeout=10) as response:
            response_body = response.read().decode("utf-8")
    except HTTPError as exc:
        error_body = exc.read().decode("utf-8")
        detail = error_body or exc.reason
        raise SandboxClientError(
            f"sandbox_http_error {exc.code}: {detail}", status_code=exc.code
        ) from exc
    except URLError as exc:
        raise SandboxClientError(f"sandbox_unreachable: {exc.reason}") from exc

    try:
        return json.loads(response_body) if response_body else {}
    except json.JSONDecodeError as exc:
        raise SandboxClientError("sandbox returned invalid JSON") from exc


async def _request_model(
    model_type: type[Any], method: str, path: str, payload: dict[str, Any] | None = None
) -> Any:
    data = await asyncio.to_thread(_request_json, method, path, payload)
    return model_type.model_validate(data)


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
