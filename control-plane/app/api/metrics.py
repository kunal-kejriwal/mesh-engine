"""
Metrics API — exposes Redis-backed observability counters.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Optional

from app.services.metrics_service import MetricsService, GlobalMetrics, NetworkMetrics

router = APIRouter(prefix="/metrics", tags=["Observability"])

_svc = MetricsService()


class NetworkMetricsResponse(BaseModel):
    network_id: str
    total_messages: int
    successful_deliveries: int
    failed_deliveries: int
    success_rate: float
    avg_latency_ms: float


class GlobalMetricsResponse(BaseModel):
    total_messages: int
    successful_deliveries: int
    failed_deliveries: int
    success_rate: float
    avg_latency_ms: float
    total_reroutes: int
    per_network: Dict[str, NetworkMetricsResponse]


@router.get(
    "",
    response_model=GlobalMetricsResponse,
    summary="Global mesh observability metrics",
    description=(
        "Returns aggregate counters across all networks:\n\n"
        "- `total_messages` — all messages ever sent\n"
        "- `successful_deliveries` — messages that reached destination\n"
        "- `failed_deliveries` — messages with no route\n"
        "- `success_rate` — successful / total\n"
        "- `avg_latency_ms` — mean end-to-end routing latency\n"
        "- `total_reroutes` — self-healing reroutes triggered by simulations\n"
        "- `per_network` — same stats broken down per network\n\n"
        "Counters are stored in Redis with atomic INCR operations."
    ),
)
async def get_global_metrics() -> GlobalMetricsResponse:
    try:
        m = await _svc.get_global_metrics()
        return GlobalMetricsResponse(
            total_messages=m.total_messages,
            successful_deliveries=m.successful_deliveries,
            failed_deliveries=m.failed_deliveries,
            success_rate=m.success_rate,
            avg_latency_ms=m.avg_latency_ms,
            total_reroutes=m.total_reroutes,
            per_network={
                nid: NetworkMetricsResponse(
                    network_id=nm.network_id,
                    total_messages=nm.total_messages,
                    successful_deliveries=nm.successful_deliveries,
                    failed_deliveries=nm.failed_deliveries,
                    success_rate=nm.success_rate,
                    avg_latency_ms=nm.avg_latency_ms,
                )
                for nid, nm in m.per_network.items()
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "METRICS_UNAVAILABLE", "message": str(exc)},
        )


@router.get(
    "/{network_id}",
    response_model=NetworkMetricsResponse,
    summary="Per-network metrics",
)
async def get_network_metrics(network_id: str) -> NetworkMetricsResponse:
    try:
        nm = await _svc.get_network_metrics(network_id)
        return NetworkMetricsResponse(
            network_id=nm.network_id,
            total_messages=nm.total_messages,
            successful_deliveries=nm.successful_deliveries,
            failed_deliveries=nm.failed_deliveries,
            success_rate=nm.success_rate,
            avg_latency_ms=nm.avg_latency_ms,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


from fastapi import Response, status

@router.delete(
    "/reset",
    summary="Reset all metrics (test/debug use only)",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,  # 👈 IMPORTANT
)
async def reset_metrics() -> Response:
    await _svc.reset()
    return Response(status_code=status.HTTP_204_NO_CONTENT)