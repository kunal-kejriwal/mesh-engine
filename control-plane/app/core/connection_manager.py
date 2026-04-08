"""
WebSocket Connection Manager — singleton managing all /ws/simulation clients.

Thread model: FastAPI + uvicorn run a single asyncio event loop. Python's
cooperative scheduling guarantees that between two `await` points, only one
coroutine runs. Set mutations and iteration are therefore safe without a mutex
as long as we never hold a reference across an await while expecting the set
to be unchanged. We snapshot the set with `list()` before every broadcast loop
so that removals during iteration do not cause RuntimeError.
"""
from __future__ import annotations

import json
from typing import Set

from fastapi import WebSocket

from app.core.logging import get_logger

logger = get_logger(__name__)

_instance: "ConnectionManager | None" = None


class ConnectionManager:
    """
    Manages the pool of active WebSocket connections to /ws/simulation.

    Public interface:
        connect(ws)          — accept and register a new client
        disconnect(ws)       — deregister (called on disconnect)
        broadcast(event)     — send JSON event to all live clients
        send_to(ws, event)   — send to a single client
        client_count         — number of currently active clients
    """

    def __init__(self) -> None:
        self._clients: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._clients.add(websocket)
        logger.info("ws_client_added", total=len(self._clients))

    def disconnect(self, websocket: WebSocket) -> None:
        self._clients.discard(websocket)
        logger.info("ws_client_removed", total=len(self._clients))

    async def broadcast(self, event: dict) -> None:
        """
        Fan-out event to every connected client.

        Clients that raise on send are silently dropped — a broken pipe
        should not interrupt delivery to healthy clients.
        """
        if not self._clients:
            return

        payload = json.dumps(event, default=str)
        dead: list[WebSocket] = []

        for ws in list(self._clients):   # snapshot before async iteration
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self._clients.discard(ws)
            logger.debug("ws_dead_client_purged")

    async def send_to(self, websocket: WebSocket, event: dict) -> None:
        try:
            await websocket.send_json(event)
        except Exception as exc:
            logger.warning("ws_send_failed", error=str(exc))
            self._clients.discard(websocket)

    @property
    def client_count(self) -> int:
        return len(self._clients)


def get_connection_manager() -> ConnectionManager:
    """Return the process-scoped singleton ConnectionManager."""
    global _instance
    if _instance is None:
        _instance = ConnectionManager()
    return _instance
