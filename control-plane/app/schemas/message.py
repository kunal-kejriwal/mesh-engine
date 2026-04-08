from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class MessageSend(BaseModel):
    network_id: str
    source_id: str
    destination_id: str
    payload: str = Field(min_length=1, max_length=4096)


class HopEvent(BaseModel):
    hop: int
    from_node_id: str
    to_node_id: str
    link_latency_ms: float
    cumulative_latency_ms: float
    timestamp: str


class RouteInfo(BaseModel):
    path: List[str]
    total_latency_ms: float
    hop_count: int


class MessageResponse(BaseModel):
    id: str
    trace_id: Optional[str] = None
    network_id: str
    source_id: str
    destination_id: str
    payload: str
    status: str
    path: List[str]
    hops_completed: int
    total_latency_ms: float
    hop_log: List[Dict[str, Any]]
    created_at: datetime
    delivered_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ── Trace schemas ─────────────────────────────────────────────────────────────

class TraceHop(BaseModel):
    """Single hop in a message trace — enriched with node names."""
    hop: int
    from_node_id: str
    from_node_name: str
    to_node_id: str
    to_node_name: str
    link_latency_ms: float
    cumulative_latency_ms: float
    timestamp: str


class TraceSummary(BaseModel):
    first_hop_at: Optional[str]
    last_hop_at: Optional[str]
    total_path_latency_ms: float
    hops: int


class MessageTrace(BaseModel):
    """
    Full lifecycle trace for a message — returned by GET /message/{id}/trace.

    Enriches the raw Message record with node names and timing summary.
    """
    trace_id: Optional[str]
    message_id: str
    network_id: str
    status: str
    source_id: str
    source_name: str
    destination_id: str
    destination_name: str
    payload: str
    path: List[str]
    path_names: List[str]
    total_latency_ms: float
    hops_completed: int
    created_at: datetime
    delivered_at: Optional[datetime]
    hops: List[TraceHop]
    timing: TraceSummary
