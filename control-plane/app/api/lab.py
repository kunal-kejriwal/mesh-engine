"""
Simulation Lab API — additive preset and scenario endpoints.

Routes:
    GET  /lab/presets                → List all available preset scenarios
    POST /lab/presets/{name}/deploy  → Instantiate a named preset network + return IDs
    GET  /lab/presets/{name}         → Get preset specification (nodes, topology)

These endpoints wrap the existing /network/create and /simulation/start APIs.
They do NOT modify any existing service logic — they compose existing services
with pre-defined topologies for the interactive lab UI.

Presets:
    dense_grid   — 9-node 3×3 grid, high connectivity, short paths
    sparse_web   — 6-node web, 2-link threshold, partition-prone
    star_hub     — Hub-and-spoke, 1 hub + 5 leaves; hub failure = partition
    mid_failure  — 5-node linear chain, mid-node pre-selected for failure demo
"""
from __future__ import annotations

import math
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.schemas.network import NetworkCreate, NodeCreate
from app.services.network_service import NetworkService

router = APIRouter(prefix="/lab", tags=["Simulation Lab"])
logger = get_logger(__name__)


# ── Preset definitions ────────────────────────────────────────────────────────

class PresetNode(BaseModel):
    name: str
    x: float
    y: float
    latency_ms: float = 10.0


class PresetSpec(BaseModel):
    name: str
    label: str
    description: str
    link_threshold: float
    nodes: List[PresetNode]
    recommended_source: str
    recommended_destination: str
    recommended_fail_nodes: List[str]
    scenario_narrative: str


def _dense_grid() -> PresetSpec:
    """3×3 grid — 9 nodes, high connectivity, multiple redundant paths."""
    nodes = []
    for row in range(3):
        for col in range(3):
            nodes.append(PresetNode(
                name=f"N{row * 3 + col + 1}",
                x=float(col * 100 + 50),
                y=float(row * 100 + 50),
                latency_ms=8.0,
            ))
    return PresetSpec(
        name="dense_grid",
        label="Dense Grid Network",
        description="9-node 3×3 grid topology with high redundancy. 4+ paths exist between any two nodes.",
        link_threshold=120.0,
        nodes=nodes,
        recommended_source="N1",
        recommended_destination="N9",
        recommended_fail_nodes=["N5"],
        scenario_narrative=(
            "N1→N9 initially routes through the center (N5). "
            "Failing N5 forces Dijkstra to reroute via N2→N3→N6→N9 or N4→N7→N8→N9. "
            "Demonstrates self-healing in a dense topology."
        ),
    )


def _sparse_web() -> PresetSpec:
    """6-node web — sparse connectivity, single bridges likely."""
    nodes = [
        PresetNode(name="Hub",    x=150.0, y=150.0, latency_ms=5.0),
        PresetNode(name="Alpha",  x=50.0,  y=50.0,  latency_ms=12.0),
        PresetNode(name="Beta",   x=250.0, y=50.0,  latency_ms=12.0),
        PresetNode(name="Gamma",  x=300.0, y=200.0, latency_ms=15.0),
        PresetNode(name="Delta",  x=150.0, y=280.0, latency_ms=18.0),
        PresetNode(name="Epsilon",x=20.0,  y=200.0, latency_ms=20.0),
    ]
    return PresetSpec(
        name="sparse_web",
        label="Sparse Web Network",
        description="6-node sparse topology. Hub acts as single point of failure — failing it partitions the network.",
        link_threshold=180.0,
        nodes=nodes,
        recommended_source="Alpha",
        recommended_destination="Gamma",
        recommended_fail_nodes=["Hub"],
        scenario_narrative=(
            "Alpha→Gamma routes via Hub. Failing Hub causes network partition — "
            "no alternate path exists. Simulation returns FAILED with NETWORK_PARTITIONED explanation. "
            "Demonstrates the risk of hub-and-spoke topologies."
        ),
    )


def _star_hub() -> PresetSpec:
    """Star topology — 1 hub + 5 leaves, hub failure = total partition."""
    cx, cy = 150.0, 150.0
    radius = 120.0
    leaves = []
    for i in range(5):
        angle = (2 * math.pi * i) / 5
        leaves.append(PresetNode(
            name=f"Leaf{i + 1}",
            x=round(cx + radius * math.cos(angle), 1),
            y=round(cy + radius * math.sin(angle), 1),
            latency_ms=10.0,
        ))
    nodes = [PresetNode(name="Hub", x=cx, y=cy, latency_ms=3.0)] + leaves
    return PresetSpec(
        name="star_hub",
        label="Star Hub Topology",
        description="Hub-and-spoke: 5 leaf nodes all connect through one central hub.",
        link_threshold=140.0,
        nodes=nodes,
        recommended_source="Leaf1",
        recommended_destination="Leaf3",
        recommended_fail_nodes=["Hub"],
        scenario_narrative=(
            "All inter-leaf routing passes through Hub. Killing Hub completely partitions "
            "the network — zero paths between any leaves. Demonstrates why hub-and-spoke "
            "topologies lack resilience and why mesh routing was designed."
        ),
    )


def _mid_failure() -> PresetSpec:
    """Linear 5-node chain — mid-node failure forces reroute or failure."""
    nodes = [
        PresetNode(name="Start",  x=50.0,  y=150.0, latency_ms=5.0),
        PresetNode(name="Relay1", x=130.0, y=80.0,  latency_ms=10.0),
        PresetNode(name="Bridge", x=200.0, y=150.0, latency_ms=8.0),
        PresetNode(name="Relay2", x=270.0, y=80.0,  latency_ms=10.0),
        PresetNode(name="End",    x=350.0, y=150.0, latency_ms=5.0),
    ]
    return PresetSpec(
        name="mid_failure",
        label="Mid-Route Failure",
        description="5-node chain. The center Bridge node is injected as a failure mid-simulation.",
        link_threshold=110.0,
        nodes=nodes,
        recommended_source="Start",
        recommended_destination="End",
        recommended_fail_nodes=["Bridge"],
        scenario_narrative=(
            "Initial route: Start→Relay1→Bridge→Relay2→End. "
            "Bridge fails mid-simulation. Dijkstra checks alternate path Start→Relay1→Relay2→End "
            "(if within link_threshold) or declares FAILED. "
            "Demonstrates failure injection and real-time reroute detection."
        ),
    )


_PRESETS: dict[str, PresetSpec] = {
    spec.name: spec
    for spec in [_dense_grid(), _sparse_web(), _star_hub(), _mid_failure()]
}


# ── Response schemas ──────────────────────────────────────────────────────────

class PresetListItem(BaseModel):
    name: str
    label: str
    description: str
    node_count: int


class DeployedPreset(BaseModel):
    preset_name: str
    network_id: str
    node_map: dict[str, str]        # node_name → node_id
    recommended_source_id: str
    recommended_destination_id: str
    recommended_fail_node_ids: List[str]
    scenario_narrative: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get(
    "/presets",
    response_model=List[PresetListItem],
    summary="List simulation lab presets",
)
async def list_presets() -> List[PresetListItem]:
    """Return all available preset scenario definitions."""
    return [
        PresetListItem(
            name=p.name,
            label=p.label,
            description=p.description,
            node_count=len(p.nodes),
        )
        for p in _PRESETS.values()
    ]


@router.get(
    "/presets/{name}",
    response_model=PresetSpec,
    summary="Get preset specification",
)
async def get_preset(name: str) -> PresetSpec:
    """Return the full specification for a named preset."""
    preset = _PRESETS.get(name)
    if not preset:
        raise HTTPException(
            status_code=404,
            detail=f"Preset '{name}' not found. Available: {list(_PRESETS.keys())}",
        )
    return preset


@router.post(
    "/presets/{name}/deploy",
    response_model=DeployedPreset,
    summary="Deploy a preset network into the simulation",
    description=(
        "Creates a fresh network using the preset topology via the existing "
        "/network/create flow. Returns the network_id and a name→id mapping "
        "so the frontend can immediately run /simulation/start."
    ),
)
async def deploy_preset(
    name: str,
    db: AsyncSession = Depends(get_db),
) -> DeployedPreset:
    """Instantiate a preset topology and return addressable IDs."""
    preset = _PRESETS.get(name)
    if not preset:
        raise HTTPException(
            status_code=404,
            detail=f"Preset '{name}' not found. Available: {list(_PRESETS.keys())}",
        )

    svc = NetworkService(db)
    network_data = NetworkCreate(
        name=f"[Lab] {preset.label}",
        link_threshold=preset.link_threshold,
        nodes=[
            NodeCreate(
                name=n.name,
                x=n.x,
                y=n.y,
                latency_ms=n.latency_ms,
            )
            for n in preset.nodes
        ],
    )

    try:
        network = await svc.create_network(network_data)
    except Exception as exc:
        logger.error("lab_deploy_failed", preset=name, error=str(exc))
        raise HTTPException(status_code=500, detail=f"Failed to deploy preset: {exc}")

    # Build name → id map
    node_map: dict[str, str] = {n.name: n.id for n in network.nodes}

    src_id = node_map.get(preset.recommended_source, "")
    dst_id = node_map.get(preset.recommended_destination, "")
    fail_ids = [node_map[fn] for fn in preset.recommended_fail_nodes if fn in node_map]

    logger.info(
        "lab_preset_deployed",
        preset=name,
        network_id=network.id,
        nodes=len(network.nodes),
    )

    return DeployedPreset(
        preset_name=name,
        network_id=network.id,
        node_map=node_map,
        recommended_source_id=src_id,
        recommended_destination_id=dst_id,
        recommended_fail_node_ids=fail_ids,
        scenario_narrative=preset.scenario_narrative,
    )
