from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class SimulationStart(BaseModel):
    network_id: str
    source_id: str
    destination_id: str
    payload: str = "SIMULATION_PAYLOAD"
    fail_nodes: Optional[List[str]] = Field(
        default=None,
        description="Node IDs to fail mid-simulation to demonstrate self-healing",
    )


class SimulationResult(BaseModel):
    simulation_id: str
    network_id: str
    status: str
    initial_path: List[str]
    initial_latency_ms: float
    rerouted: bool
    final_path: Optional[List[str]] = None
    final_latency_ms: Optional[float] = None
    failed_nodes: List[str]
    message_id: str
    explanation: str
