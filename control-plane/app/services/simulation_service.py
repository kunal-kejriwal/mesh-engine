"""
Simulation service — orchestrates a full end-to-end self-healing scenario.

Phase 2 enhancements:
- Uses emit_event() (dual-publish) instead of raw redis.publish().
- Passes simulation_id as trace_id so all messages in a run share a trace.
- Records reroute count via MetricsService.
- All events are now streamed to /ws/simulation clients in real time.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import emit_event
from app.core.exceptions import NoRouteException
from app.core.logging import get_logger
from app.schemas.message import MessageSend
from app.schemas.simulation import SimulationResult, SimulationStart
from app.services.message_service import MessageService
from app.services.metrics_service import MetricsService
from app.services.network_service import NetworkService
from app.services.routing_service import RoutingService

logger = get_logger(__name__)

_metrics = MetricsService()


class SimulationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._network_svc = NetworkService(db)
        self._routing_svc = RoutingService(db)
        self._message_svc = MessageService(db)

    async def run(self, data: SimulationStart) -> SimulationResult:
        sim_id = str(uuid.uuid4())
        failed_nodes: List[str] = []

        await emit_event("simulation", {
            "event_type": "SIMULATION_STARTED",
            "simulation_id": sim_id,
            "network_id": data.network_id,
            "source_id": data.source_id,
            "destination_id": data.destination_id,
        })

        # ── Phase 1: Initial route ──────────────────────────────────────
        initial_route = await self._routing_svc.compute_route(
            data.network_id, data.source_id, data.destination_id
        )
        logger.info(
            "sim_initial_route",
            sim_id=sim_id,
            path=initial_route.path,
            latency_ms=initial_route.total_latency_ms,
        )
        await emit_event("simulation", {
            "event_type": "ROUTE_COMPUTED",
            "simulation_id": sim_id,
            "phase": "initial",
            "path": initial_route.path,
            "latency_ms": initial_route.total_latency_ms,
            "hop_count": initial_route.hop_count,
        })

        final_route = initial_route
        rerouted = False

        # ── Phase 2: Inject failures ────────────────────────────────────
        if data.fail_nodes:
            for node_id in data.fail_nodes:
                try:
                    await self._network_svc.fail_node(node_id)
                    failed_nodes.append(node_id)
                    await emit_event("node", {
                        "event_type": "NODE_DOWN",
                        "simulation_id": sim_id,
                        "node_id": node_id,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                    logger.warning(
                        "sim_node_injected_failure", sim_id=sim_id, node_id=node_id
                    )
                except Exception as exc:
                    logger.error("sim_fail_node_error", node_id=node_id, error=str(exc))

            # ── Phase 3: Self-healing re-route ──────────────────────────
            try:
                final_route = await self._routing_svc.compute_route(
                    data.network_id, data.source_id, data.destination_id
                )
                rerouted = final_route.path != initial_route.path

                if rerouted:
                    await _metrics.record_reroute()

                logger.info(
                    "sim_rerouted",
                    sim_id=sim_id,
                    rerouted=rerouted,
                    old_path=initial_route.path,
                    new_path=final_route.path,
                )
                await emit_event("simulation", {
                    "event_type": "ROUTE_RECOMPUTED",
                    "simulation_id": sim_id,
                    "phase": "after_failure",
                    "path": final_route.path,
                    "latency_ms": final_route.total_latency_ms,
                    "rerouted": rerouted,
                    "failed_nodes": failed_nodes,
                })

            except NoRouteException:
                await emit_event("simulation", {
                    "event_type": "SIMULATION_FAILED",
                    "simulation_id": sim_id,
                    "reason": "NO_ROUTE_AFTER_FAILURE",
                    "failed_nodes": failed_nodes,
                })
                return SimulationResult(
                    simulation_id=sim_id,
                    network_id=data.network_id,
                    status="FAILED",
                    initial_path=initial_route.path,
                    initial_latency_ms=initial_route.total_latency_ms,
                    rerouted=False,
                    final_path=None,
                    final_latency_ms=None,
                    failed_nodes=failed_nodes,
                    message_id="",
                    explanation=(
                        f"Network partitioned. No path from "
                        f"'{data.source_id}' to '{data.destination_id}' "
                        f"after failing nodes: {failed_nodes}."
                    ),
                )

        # ── Phase 4: Deliver message on final path ──────────────────────
        # Pass sim_id as trace_id so the message shares this simulation's trace
        message = await self._message_svc.send_message(
            MessageSend(
                network_id=data.network_id,
                source_id=data.source_id,
                destination_id=data.destination_id,
                payload=data.payload,
            ),
            trace_id=sim_id,
        )

        await emit_event("simulation", {
            "event_type": "SIMULATION_COMPLETED",
            "simulation_id": sim_id,
            "message_id": message.id,
            "final_path": final_route.path,
            "status": "SUCCESS",
        })

        explanation = self._build_explanation(
            initial_route.path, final_route.path, failed_nodes, rerouted
        )

        return SimulationResult(
            simulation_id=sim_id,
            network_id=data.network_id,
            status="SUCCESS",
            initial_path=initial_route.path,
            initial_latency_ms=initial_route.total_latency_ms,
            rerouted=rerouted,
            final_path=final_route.path,
            final_latency_ms=final_route.total_latency_ms,
            failed_nodes=failed_nodes,
            message_id=message.id,
            explanation=explanation,
        )

    # ------------------------------------------------------------------ #
    # Internals                                                            #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _build_explanation(
        initial_path: list,
        final_path: list,
        failed_nodes: list,
        rerouted: bool,
    ) -> str:
        init_str = " → ".join(initial_path)
        if not failed_nodes:
            return f"Message routed via: {init_str}. No failures injected."
        final_str = " → ".join(final_path)
        nodes_str = ", ".join(failed_nodes)
        if rerouted:
            return (
                f"Initial path: {init_str}. "
                f"Nodes failed: [{nodes_str}]. "
                f"Self-healing reroute activated. "
                f"New path: {final_str}."
            )
        return (
            f"Path: {init_str}. "
            f"Nodes failed: [{nodes_str}] but not on active path — no reroute needed."
        )
