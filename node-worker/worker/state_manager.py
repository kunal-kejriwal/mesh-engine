"""
Local state manager for the node worker.

Tracks which nodes are known to be DOWN based on events received from Redis.
This is a local, in-memory view — not authoritative. The DB is the source
of truth; this is used only for logging and diagnostic output.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional


@dataclass
class NodeState:
    node_id: str
    status: str = "UP"
    last_seen: Optional[str] = None
    failure_reason: Optional[str] = None


class LocalStateManager:
    """
    In-memory index of node states seen by this worker.
    Updated by consuming Redis events.
    """

    def __init__(self) -> None:
        self._nodes: Dict[str, NodeState] = {}

    def mark_down(self, node_id: str, reason: str = "event") -> None:
        state = self._nodes.setdefault(node_id, NodeState(node_id=node_id))
        state.status = "DOWN"
        state.failure_reason = reason
        state.last_seen = datetime.now(timezone.utc).isoformat()

    def mark_up(self, node_id: str) -> None:
        state = self._nodes.setdefault(node_id, NodeState(node_id=node_id))
        state.status = "UP"
        state.failure_reason = None
        state.last_seen = datetime.now(timezone.utc).isoformat()

    def get_status(self, node_id: str) -> str:
        return self._nodes.get(node_id, NodeState(node_id=node_id)).status

    def snapshot(self) -> Dict[str, str]:
        return {nid: s.status for nid, s in self._nodes.items()}

    def down_nodes(self) -> list[str]:
        return [nid for nid, s in self._nodes.items() if s.status == "DOWN"]
