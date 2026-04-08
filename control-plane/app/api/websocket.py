"""
WebSocket endpoints — real-time event streaming.

Two endpoints are available:

/ws/stream       (Phase 1 — unchanged)
    Redis pub/sub bridge. Each client gets its own pubsub subscription.
    Suitable for external monitoring tools that connect once and listen.

/ws/simulation   (Phase 2 — new)
    Uses the ConnectionManager singleton. Events are pushed directly
    from service calls without a Redis round-trip, giving sub-millisecond
    delivery to connected dashboards. This is the primary endpoint for
    the MeshEngine frontend.

Both endpoints are additive — they can be used simultaneously.

Event schema:
    {
        "event_type": str,      # MESSAGE_SENT | MESSAGE_HOP | MESSAGE_DELIVERED |
                                 # MESSAGE_FAILED | NODE_DOWN | NODE_RECOVERED |
                                 # ROUTE_COMPUTED | ROUTE_RECOMPUTED |
                                 # SIMULATION_STARTED | SIMULATION_COMPLETED |
                                 # PING | CONNECTED
        "timestamp": str,       # ISO-8601 UTC
        ... event-specific fields ...
    }
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.connection_manager import get_connection_manager
from app.core.logging import get_logger
from app.core.redis_client import get_redis

router = APIRouter(tags=["Real-time"])
logger = get_logger(__name__)

_REDIS_CHANNELS = [
    "mesh:message:flow",
    "mesh:simulation:events",
    "mesh:node:events",
]


# ── /ws/simulation — ConnectionManager-based ──────────────────────────────────

@router.websocket("/ws/simulation")
async def websocket_simulation(websocket: WebSocket) -> None:
    """
    Primary real-time WebSocket endpoint for the MeshEngine dashboard.

    Events are pushed directly from service calls via the ConnectionManager.
    No Redis round-trip — latency between event emission and client delivery
    is bounded only by the asyncio event loop.

    Connect here for:
    - MESSAGE_SENT / MESSAGE_HOP / MESSAGE_DELIVERED / MESSAGE_FAILED
    - NODE_DOWN / NODE_RECOVERED
    - SIMULATION_STARTED / ROUTE_COMPUTED / ROUTE_RECOMPUTED / SIMULATION_COMPLETED
    """
    manager = get_connection_manager()
    await manager.connect(websocket)

    try:
        await manager.send_to(websocket, {
            "event_type": "CONNECTED",
            "endpoint": "/ws/simulation",
            "message": "Direct event stream active. Subscribed to all mesh events.",
        })

        # Keep connection alive — the manager handles delivery.
        # We just need to pump the receive loop to detect disconnects.
        while True:
            try:
                # Wait for client messages or disconnect signal
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                # Send keepalive — client is still connected
                await manager.send_to(websocket, {"event_type": "PING"})
            except WebSocketDisconnect:
                break

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)


# ── /ws/stream — Redis pub/sub bridge (Phase 1, unchanged) ────────────────────

@router.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket) -> None:
    """
    Redis pub/sub bridge — each connection gets a dedicated subscription.

    Suitable for external tools (CLI watchers, test harnesses) that subscribe
    to the raw Redis channel stream. Uses one Redis connection per client.

    For the browser dashboard, prefer /ws/simulation which has direct delivery.
    """
    await websocket.accept()
    redis = await get_redis()
    pubsub = redis.pubsub()

    try:
        await pubsub.subscribe(*_REDIS_CHANNELS)
        logger.info("ws_stream_client_connected", channels=_REDIS_CHANNELS)

        await websocket.send_json({
            "event_type": "CONNECTED",
            "endpoint": "/ws/stream",
            "message": "Redis pub/sub stream active.",
            "channels": _REDIS_CHANNELS,
        })

        while True:
            try:
                raw = await asyncio.wait_for(
                    pubsub.get_message(ignore_subscribe_messages=True),
                    timeout=1.0,
                )
                if raw and raw.get("type") == "message":
                    payload = json.loads(raw["data"])
                    await websocket.send_json(payload)
                else:
                    await websocket.send_json({"event_type": "PING"})
            except asyncio.TimeoutError:
                await websocket.send_json({"event_type": "PING"})
            except WebSocketDisconnect:
                break
            except Exception as exc:
                logger.error("ws_stream_error", error=str(exc))
                break

    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(*_REDIS_CHANNELS)
        await pubsub.aclose()
        logger.info("ws_stream_client_disconnected")
