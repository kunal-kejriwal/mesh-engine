"""
EventBus — dual-publish to Redis pub/sub AND WebSocket clients.

All services MUST call emit_event() rather than redis.publish() directly.
This ensures:

1. Redis pub/sub receives the event → consumed by node-worker replicas
   and the Redis-backed /ws/stream endpoint.

2. The ConnectionManager broadcasts directly to /ws/simulation clients
   without the Redis round-trip — critical for low-latency hop animations.

Channel routing table:
    "message"    → mesh:message:flow
    "node"       → mesh:node:events
    "simulation" → mesh:simulation:events

You may pass either a shorthand key or a literal channel name — both work.

Event schema convention (all events):
    {
        "event_type": str,      # discriminator
        "timestamp": str,       # ISO-8601 UTC — auto-injected if missing
        ... event-specific fields at the top level ...
    }
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from app.core.logging import get_logger
from app.core.redis_client import get_redis

logger = get_logger(__name__)

_CHANNEL_MAP: dict[str, str] = {
    "message": "mesh:message:flow",
    "node": "mesh:node:events",
    "simulation": "mesh:simulation:events",
}


def _resolve(channel_key: str) -> str:
    return _CHANNEL_MAP.get(channel_key, channel_key)


async def emit_event(channel_key: str, event: dict) -> None:
    """
    Publish an event to Redis AND broadcast to all /ws/simulation clients.

    Never raises — failures are logged at WARNING level so that a broken
    Redis connection does not propagate into request handlers.
    """
    event.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
    channel = _resolve(channel_key)
    payload = json.dumps(event, default=str)

    # ── Redis pub/sub ─────────────────────────────────────────────────────
    try:
        redis = await get_redis()
        await redis.publish(channel, payload)
    except Exception as exc:
        logger.warning("event_redis_failed", channel=channel, error=str(exc))

    # ── Direct WebSocket broadcast ────────────────────────────────────────
    try:
        from app.core.connection_manager import get_connection_manager
        mgr = get_connection_manager()
        if mgr.client_count > 0:
            await mgr.broadcast(event)
    except Exception as exc:
        logger.warning("event_ws_failed", error=str(exc))
