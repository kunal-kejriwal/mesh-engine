"""
NodeWorker — Execution Plane subscriber.

Phase 2 enhancements:
- Handles new event types: MESSAGE_SENT, MESSAGE_HOP, MESSAGE_FAILED,
  NODE_DOWN, NODE_RECOVERED (renamed from NODE_FAILED/NODE_RECOVERED).
- Maintains per-message trace in local state for diagnostic output.
- Structured log lines include trace_id for correlation.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Callable, Coroutine, Dict, List

import redis.asyncio as aioredis

from worker.state_manager import LocalStateManager

logger = logging.getLogger("node_worker")

CHANNELS = [
    "mesh:message:flow",
    "mesh:simulation:events",
    "mesh:node:events",
]

_Handler = Callable[[dict], Coroutine]


class NodeWorker:
    def __init__(self) -> None:
        self.worker_id = os.getenv("WORKER_ID", "worker-1")
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        self._state = LocalStateManager()
        self._running = True

        # In-memory trace cache: trace_id → list of hop summaries
        self._traces: Dict[str, List[dict]] = {}

        self._handlers: Dict[str, _Handler] = {
            # Message lifecycle
            "MESSAGE_SENT":      self._on_message_sent,
            "MESSAGE_HOP":       self._on_message_hop,
            "MESSAGE_DELIVERED": self._on_message_delivered,
            "MESSAGE_FAILED":    self._on_message_failed,
            # Node lifecycle (Phase 2 naming)
            "NODE_DOWN":         self._on_node_down,
            "NODE_RECOVERED":    self._on_node_recovered,
            # Legacy naming (Phase 1 compat)
            "NODE_FAILED":       self._on_node_down,
            # Routing
            "ROUTE_COMPUTED":    self._on_route_computed,
            "ROUTE_RECOMPUTED":  self._on_route_recomputed,
            # Simulation
            "SIMULATION_STARTED":   self._on_simulation_started,
            "SIMULATION_COMPLETED": self._on_simulation_completed,
            "SIMULATION_FAILED":    self._on_simulation_failed,
        }

    def stop(self) -> None:
        self._running = False

    async def run(self) -> None:
        client = aioredis.from_url(
            self.redis_url, encoding="utf-8", decode_responses=True
        )
        pubsub = client.pubsub()
        await pubsub.subscribe(*CHANNELS)

        logger.info("[%s] Subscribed to: %s", self.worker_id, ", ".join(CHANNELS))

        try:
            while self._running:
                raw = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
                if raw and raw.get("type") == "message":
                    try:
                        event = json.loads(raw["data"])
                        await self._dispatch(raw["channel"], event)
                    except json.JSONDecodeError as exc:
                        logger.warning("[%s] Malformed event: %s", self.worker_id, exc)
                    except Exception as exc:
                        logger.error("[%s] Handler error: %s", self.worker_id, exc, exc_info=True)
        finally:
            await pubsub.unsubscribe(*CHANNELS)
            await pubsub.aclose()
            await client.aclose()
            logger.info("[%s] Worker stopped.", self.worker_id)

    async def _dispatch(self, channel: str, event: dict) -> None:
        event_type = event.get("event_type", "UNKNOWN")
        handler = self._handlers.get(event_type)
        if handler:
            await handler(event)

    # ────────────────────────────────────────────────────────────────── #
    # Message handlers                                                    #
    # ────────────────────────────────────────────────────────────────── #

    async def _on_message_sent(self, event: dict) -> None:
        tid = event.get("trace_id", "?")
        mid = event.get("message_id", "?")
        self._traces[tid] = []
        logger.info(
            "[%s] MESSAGE_SENT  msg=%s  trace=%s  %s → %s",
            self.worker_id, mid[:8], tid[:8],
            event.get("source_id", "?")[:8],
            event.get("destination_id", "?")[:8],
        )

    async def _on_message_hop(self, event: dict) -> None:
        tid = event.get("trace_id", "?")
        self._traces.setdefault(tid, []).append({
            "hop": event.get("hop"),
            "from": event.get("from_node_id", "?")[:8],
            "to":   event.get("to_node_id",   "?")[:8],
            "lat":  event.get("link_latency_ms", 0),
        })
        logger.info(
            "[%s] MESSAGE_HOP   trace=%s  hop=%s  %s → %s  %.2fms (cumulative: %.2fms)",
            self.worker_id,
            tid[:8],
            event.get("hop"),
            event.get("from_node_id", "?")[:8],
            event.get("to_node_id",   "?")[:8],
            event.get("link_latency_ms", 0),
            event.get("cumulative_latency_ms", 0),
        )

    async def _on_message_delivered(self, event: dict) -> None:
        tid = event.get("trace_id", "?")
        trace = self._traces.pop(tid, [])
        logger.info(
            "[%s] MESSAGE_DELIVERED  msg=%s  trace=%s  path=[%s]  %.2fms  %s hops  trace_hops=%d",
            self.worker_id,
            event.get("message_id", "?")[:8],
            tid[:8],
            " → ".join(n[:8] for n in event.get("path", [])),
            event.get("total_latency_ms", 0),
            event.get("hop_count", 0),
            len(trace),
        )

    async def _on_message_failed(self, event: dict) -> None:
        tid = event.get("trace_id", "?")
        self._traces.pop(tid, None)
        logger.error(
            "[%s] MESSAGE_FAILED  msg=%s  trace=%s  reason=%s",
            self.worker_id,
            event.get("message_id", "?")[:8],
            tid[:8],
            event.get("reason", "UNKNOWN"),
        )

    # ────────────────────────────────────────────────────────────────── #
    # Node handlers                                                       #
    # ────────────────────────────────────────────────────────────────── #

    async def _on_node_down(self, event: dict) -> None:
        node_id = event.get("node_id", "?")
        self._state.mark_down(node_id, reason=event.get("event_type", "NODE_DOWN"))
        logger.warning(
            "[%s] NODE_DOWN  node=%s  network=%s  down_count=%d",
            self.worker_id,
            event.get("node_name", node_id[:8]),
            event.get("network_id", "?")[:8],
            len(self._state.down_nodes()),
        )

    async def _on_node_recovered(self, event: dict) -> None:
        node_id = event.get("node_id", "?")
        self._state.mark_up(node_id)
        logger.info(
            "[%s] NODE_RECOVERED  node=%s  down_count=%d",
            self.worker_id,
            event.get("node_name", node_id[:8]),
            len(self._state.down_nodes()),
        )

    # ────────────────────────────────────────────────────────────────── #
    # Routing handlers                                                    #
    # ────────────────────────────────────────────────────────────────── #

    async def _on_route_computed(self, event: dict) -> None:
        logger.info(
            "[%s] ROUTE_COMPUTED  phase=%s  path=[%s]  %.2fms  hops=%s",
            self.worker_id,
            event.get("phase", "?"),
            " → ".join(n[:8] for n in event.get("path", [])),
            event.get("latency_ms", 0),
            event.get("hop_count", 0),
        )

    async def _on_route_recomputed(self, event: dict) -> None:
        logger.info(
            "[%s] ROUTE_RECOMPUTED  rerouted=%s  path=[%s]  %.2fms  failed=%s",
            self.worker_id,
            event.get("rerouted"),
            " → ".join(n[:8] for n in event.get("path", [])),
            event.get("latency_ms", 0),
            event.get("failed_nodes", []),
        )

    # ────────────────────────────────────────────────────────────────── #
    # Simulation handlers                                                 #
    # ────────────────────────────────────────────────────────────────── #

    async def _on_simulation_started(self, event: dict) -> None:
        logger.info(
            "[%s] SIMULATION_STARTED  sim=%s  %s → %s",
            self.worker_id,
            event.get("simulation_id", "?")[:8],
            event.get("source_id", "?")[:8],
            event.get("destination_id", "?")[:8],
        )

    async def _on_simulation_completed(self, event: dict) -> None:
        logger.info(
            "[%s] SIMULATION_COMPLETED  sim=%s  msg=%s  path=[%s]",
            self.worker_id,
            event.get("simulation_id", "?")[:8],
            event.get("message_id", "?")[:8],
            " → ".join(n[:8] for n in event.get("final_path", [])),
        )

    async def _on_simulation_failed(self, event: dict) -> None:
        logger.error(
            "[%s] SIMULATION_FAILED  sim=%s  reason=%s  failed=%s",
            self.worker_id,
            event.get("simulation_id", "?")[:8],
            event.get("reason", "?"),
            event.get("failed_nodes", []),
        )
