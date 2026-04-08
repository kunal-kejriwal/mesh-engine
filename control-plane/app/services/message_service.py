"""
Message service — routes and dispatches messages through the mesh.

Phase 2 enhancements:
- Emits MESSAGE_SENT, MESSAGE_HOP (per hop), MESSAGE_DELIVERED, MESSAGE_FAILED
  via the dual-publish EventBus (Redis + WebSocket clients).
- Records delivery metrics via MetricsService.
- Accepts optional trace_id so simulation runs can group messages together.
- Trace endpoint can query full enriched history.

Event emission is non-fatal — a Redis outage will not prevent message routing.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import emit_event
from app.core.exceptions import MessageNotFoundException, NodeNotFoundException, NoRouteException
from app.core.logging import get_logger
from app.models.message import Message
from app.models.node import Node
from app.schemas.message import MessageSend, MessageTrace, TraceHop, TraceSummary
from app.services.metrics_service import MetricsService
from app.services.routing_service import RoutingService

logger = get_logger(__name__)

_metrics = MetricsService()


class MessageService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._routing = RoutingService(db)

    async def send_message(
        self,
        data: MessageSend,
        trace_id: Optional[str] = None,
    ) -> Message:
        """
        Route a message source → destination and emit structured lifecycle events.

        Args:
            data:     MessageSend request payload.
            trace_id: Optional external trace identifier (e.g. simulation_id).
                      Defaults to the message's own UUID when not provided.
        """
        message_id = str(uuid.uuid4())
        effective_trace_id = trace_id or message_id

        # ── Event: MESSAGE_SENT ───────────────────────────────────────────
        await emit_event("message", {
            "event_type": "MESSAGE_SENT",
            "message_id": message_id,
            "trace_id": effective_trace_id,
            "network_id": data.network_id,
            "source_id": data.source_id,
            "destination_id": data.destination_id,
            "payload_preview": data.payload[:80],
        })

        await _metrics.record_message_sent(data.network_id)

        # ── Validate endpoints ────────────────────────────────────────────
        await self._require_node(data.source_id)
        await self._require_node(data.destination_id)

        # ── Compute route ─────────────────────────────────────────────────
        try:
            route = await self._routing.compute_route(
                data.network_id, data.source_id, data.destination_id
            )
        except NoRouteException as exc:
            await _metrics.record_delivery_failure(data.network_id)
            await emit_event("message", {
                "event_type": "MESSAGE_FAILED",
                "message_id": message_id,
                "trace_id": effective_trace_id,
                "network_id": data.network_id,
                "source_id": data.source_id,
                "destination_id": data.destination_id,
                "reason": "NO_ROUTE",
                "error": exc.message,
            })
            raise

        # ── Build hop log with real edge weights ──────────────────────────
        link_weights = await self._routing.get_link_weight_map(data.network_id)
        hop_log = []
        cumulative = 0.0
        now_base = datetime.now(timezone.utc)

        for i in range(len(route.path) - 1):
            src = route.path[i]
            dst = route.path[i + 1]
            edge_cost = link_weights.get((src, dst), 0.0)
            cumulative += edge_cost
            ts = now_base.isoformat()

            hop_entry = {
                "hop": i + 1,
                "from_node_id": src,
                "to_node_id": dst,
                "link_latency_ms": round(edge_cost, 4),
                "cumulative_latency_ms": round(cumulative, 4),
                "timestamp": ts,
            }
            hop_log.append(hop_entry)

            # ── Event: MESSAGE_HOP ─────────────────────────────────────────
            await emit_event("message", {
                "event_type": "MESSAGE_HOP",
                "message_id": message_id,
                "trace_id": effective_trace_id,
                **hop_entry,
            })

        # ── Persist ───────────────────────────────────────────────────────
        delivered_at = datetime.now(timezone.utc)
        message = Message(
            id=message_id,
            trace_id=effective_trace_id,
            network_id=data.network_id,
            source_id=data.source_id,
            destination_id=data.destination_id,
            payload=data.payload,
            status="DELIVERED",
            path=route.path,
            hops_completed=route.hop_count,
            total_latency_ms=route.total_latency_ms,
            hop_log=hop_log,
            delivered_at=delivered_at,
        )
        self.db.add(message)
        await self.db.commit()

        # ── Metrics + delivery event ──────────────────────────────────────
        await _metrics.record_delivery_success(data.network_id, route.total_latency_ms)

        await emit_event("message", {
            "event_type": "MESSAGE_DELIVERED",
            "message_id": message_id,
            "trace_id": effective_trace_id,
            "network_id": data.network_id,
            "source_id": data.source_id,
            "destination_id": data.destination_id,
            "path": route.path,
            "total_latency_ms": route.total_latency_ms,
            "hop_count": route.hop_count,
        })

        logger.info(
            "message_delivered",
            message_id=message_id,
            trace_id=effective_trace_id,
            path=" -> ".join(route.path),
            latency_ms=route.total_latency_ms,
            hops=route.hop_count,
        )

        result = await self.db.execute(select(Message).where(Message.id == message_id))
        return result.scalar_one()

    async def get_message(self, message_id: str) -> Message:
        result = await self.db.execute(select(Message).where(Message.id == message_id))
        msg = result.scalar_one_or_none()
        if not msg:
            raise MessageNotFoundException(message_id)
        return msg

    async def get_trace(self, message_id: str) -> MessageTrace:
        """
        Return a fully enriched trace for a message:
        - All hop entries with node names resolved
        - Timing summary
        - Path names (human-readable)
        """
        msg = await self.get_message(message_id)

        # Collect all node IDs referenced in path + hop_log
        node_ids = set(msg.path)
        for hop in msg.hop_log:
            node_ids.add(hop.get("from_node_id", ""))
            node_ids.add(hop.get("to_node_id", ""))
        node_ids.discard("")

        # Single query to resolve names
        result = await self.db.execute(
            select(Node).where(Node.id.in_(node_ids))
        )
        name_map: dict[str, str] = {n.id: n.name for n in result.scalars().all()}

        # Enrich hops
        enriched_hops = [
            TraceHop(
                hop=h["hop"],
                from_node_id=h["from_node_id"],
                from_node_name=name_map.get(h["from_node_id"], h["from_node_id"]),
                to_node_id=h["to_node_id"],
                to_node_name=name_map.get(h["to_node_id"], h["to_node_id"]),
                link_latency_ms=h["link_latency_ms"],
                cumulative_latency_ms=h["cumulative_latency_ms"],
                timestamp=h["timestamp"],
            )
            for h in msg.hop_log
        ]

        first_hop_ts = enriched_hops[0].timestamp if enriched_hops else None
        last_hop_ts = enriched_hops[-1].timestamp if enriched_hops else None

        return MessageTrace(
            trace_id=msg.trace_id,
            message_id=msg.id,
            network_id=msg.network_id,
            status=msg.status,
            source_id=msg.source_id,
            source_name=name_map.get(msg.source_id, msg.source_id),
            destination_id=msg.destination_id,
            destination_name=name_map.get(msg.destination_id, msg.destination_id),
            payload=msg.payload,
            path=msg.path,
            path_names=[name_map.get(nid, nid) for nid in msg.path],
            total_latency_ms=msg.total_latency_ms,
            hops_completed=msg.hops_completed,
            created_at=msg.created_at,
            delivered_at=msg.delivered_at,
            hops=enriched_hops,
            timing=TraceSummary(
                first_hop_at=first_hop_ts,
                last_hop_at=last_hop_ts,
                total_path_latency_ms=msg.total_latency_ms,
                hops=msg.hops_completed,
            ),
        )

    # ------------------------------------------------------------------ #
    # Internals                                                            #
    # ------------------------------------------------------------------ #

    async def _require_node(self, node_id: str) -> Node:
        result = await self.db.execute(select(Node).where(Node.id == node_id))
        node = result.scalar_one_or_none()
        if not node:
            raise NodeNotFoundException(node_id)
        return node
