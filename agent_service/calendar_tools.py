"""Composio Google Calendar adapter for the agent service."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from agents import HostedMCPTool
from composio import Composio

from .config import settings


logger = logging.getLogger(__name__)

CALENDAR_INTENT_PATTERN = re.compile(
    r"\b("
    r"calendar|meeting|meetings|event|events|schedule|scheduled|scheduling|"
    r"book|booking|availability|available|invite|appointment|"
    r"google\s*calendar|free\s+time|busy"
    r")\b",
    re.IGNORECASE,
)

MCP_STATUS: dict[str, Any] = {
    "enabled": settings.composio_enabled,
    "attached": False,
    "server_label": "composio",
    "tool_count": 0,
    "user_id": settings.composio_user_id,
    "toolkits": [],
}


@dataclass(frozen=True)
class CalendarConnectionStatus:
    toolkit_slug: str
    is_connected: bool
    connected_account_id: str | None = None


def is_calendar_enabled() -> bool:
    return settings.composio_enabled


def required_toolkit_slugs() -> list[str]:
    return [
        slug.strip()
        for slug in settings.composio_required_toolkits.split(",")
        if slug.strip()
    ]


def detect_calendar_intent(text: str) -> bool:
    return bool(CALENDAR_INTENT_PATTERN.search(text.strip()))


def _get_composio_session():
    composio = Composio()
    return composio.create(
        user_id=settings.composio_user_id,
        toolkits=required_toolkit_slugs() or None,
        manage_connections=settings.composio_manage_connections,
    )


def get_calendar_connection_status() -> CalendarConnectionStatus:
    slug = required_toolkit_slugs()[0] if required_toolkit_slugs() else "googlecalendar"
    if not is_calendar_enabled():
        return CalendarConnectionStatus(toolkit_slug=slug, is_connected=False)

    try:
        session = _get_composio_session()
        toolkits = session.toolkits()
        for toolkit in toolkits.items:
            if toolkit.slug != slug:
                continue
            if toolkit.connection.is_active:
                account_id = None
                if toolkit.connection.connected_account:
                    account_id = toolkit.connection.connected_account.id
                return CalendarConnectionStatus(
                    toolkit_slug=slug,
                    is_connected=True,
                    connected_account_id=account_id,
                )
            return CalendarConnectionStatus(toolkit_slug=slug, is_connected=False)
    except Exception:
        logger.exception("failed to check calendar connection status")
        return CalendarConnectionStatus(toolkit_slug=slug, is_connected=False)

    return CalendarConnectionStatus(toolkit_slug=slug, is_connected=False)


def create_calendar_auth_url() -> str | None:
    if not is_calendar_enabled():
        return None

    slug = required_toolkit_slugs()[0] if required_toolkit_slugs() else "googlecalendar"
    try:
        session = _get_composio_session()
        connection_request = session.authorize(slug)
        redirect_url = getattr(connection_request, "redirect_url", None)
        if redirect_url:
            logger.info("calendar auth url created toolkit=%s", slug)
            return str(redirect_url)
    except Exception:
        logger.exception("failed to create calendar auth url")
    return None


def build_auth_reply(auth_url: str) -> str:
    return (
        "i need access to your google calendar for that - connect here, then send "
        f"your request again: {auth_url}"
    )


def build_auth_unavailable_reply() -> str:
    return (
        "i need your google calendar connected before i can check that. "
        "i couldn't make the connect link right now - try again in a minute."
    )


def build_composio_mcp_tools() -> list[HostedMCPTool]:
    if not is_calendar_enabled():
        logger.info("composio_mcp.disabled user_id=%s", settings.composio_user_id)
        MCP_STATUS.update({"attached": False, "tool_count": 0})
        return []

    try:
        session = _get_composio_session()
        tools = [
            HostedMCPTool(
                tool_config={
                    "type": "mcp",
                    "server_label": MCP_STATUS["server_label"],
                    "server_url": session.mcp.url,
                    "require_approval": "never",
                    "headers": session.mcp.headers,
                }
            )
        ]
        MCP_STATUS.update(
            {
                "attached": True,
                "tool_count": len(tools),
                "toolkits": required_toolkit_slugs(),
            }
        )
        logger.info(
            "composio_mcp.attached user_id=%s toolkits=%s tool_count=%s",
            settings.composio_user_id,
            required_toolkit_slugs(),
            len(tools),
        )
        return tools
    except Exception:
        logger.exception("failed to build composio mcp tools")
        MCP_STATUS.update({"attached": False, "tool_count": 0})
        return []


def get_mcp_status() -> dict[str, Any]:
    return dict(MCP_STATUS)
