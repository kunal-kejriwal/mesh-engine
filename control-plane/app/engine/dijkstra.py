"""
Dijkstra's shortest-path engine for MeshEngine topology routing.

Supports:
- Weighted directed/undirected edges (link latency as cost)
- Dynamic node failure injection (skips DOWN nodes during traversal)
- Node recovery (re-admits recovered nodes to future routes)
- Full path reconstruction with per-hop edge weights
"""
from __future__ import annotations

import heapq
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple


@dataclass
class _GraphNode:
    node_id: str
    neighbors: Dict[str, float] = field(default_factory=dict)  # neighbor_id -> edge weight


class MeshGraph:
    """
    Weighted graph representing the mesh network topology.

    Thread-safety: This class is NOT thread-safe. Each routing request should
    operate on its own MeshGraph instance built from the current DB snapshot.
    """

    def __init__(self) -> None:
        self._nodes: Dict[str, _GraphNode] = {}
        self._failed: Set[str] = set()

    # ------------------------------------------------------------------ #
    # Graph construction                                                   #
    # ------------------------------------------------------------------ #

    def add_node(self, node_id: str) -> None:
        if node_id not in self._nodes:
            self._nodes[node_id] = _GraphNode(node_id=node_id)

    def add_edge(
        self,
        source: str,
        target: str,
        weight: float,
        bidirectional: bool = True,
    ) -> None:
        self.add_node(source)
        self.add_node(target)
        self._nodes[source].neighbors[target] = weight
        if bidirectional:
            self._nodes[target].neighbors[source] = weight

    # ------------------------------------------------------------------ #
    # Dynamic topology mutations                                           #
    # ------------------------------------------------------------------ #

    def fail_node(self, node_id: str) -> None:
        """Mark a node as failed; it will be excluded from all future routes."""
        self._failed.add(node_id)

    def recover_node(self, node_id: str) -> None:
        """Re-admit a previously failed node to the routing graph."""
        self._failed.discard(node_id)

    def is_failed(self, node_id: str) -> bool:
        return node_id in self._failed

    # ------------------------------------------------------------------ #
    # Shortest-path algorithm                                              #
    # ------------------------------------------------------------------ #

    def dijkstra(
        self, source: str, destination: str
    ) -> Tuple[Optional[List[str]], float]:
        """
        Compute the lowest-cost path from source to destination.

        Cost = sum of edge weights (link latency in ms) along the path.
        Failed nodes are treated as non-existent — no traffic may pass
        through them.

        Returns:
            (path, total_cost) — path is an ordered list of node IDs.
            If no path exists, returns (None, inf).
        """
        if source not in self._nodes or destination not in self._nodes:
            return None, float("inf")

        if source in self._failed or destination in self._failed:
            return None, float("inf")

        # Min-heap entries: (accumulated_cost, node_id, path_so_far)
        # Tie-break on node_id ensures deterministic results across equal-cost paths.
        heap: List[Tuple[float, str, List[str]]] = [(0.0, source, [source])]
        visited: Set[str] = set()

        while heap:
            cost, current, path = heapq.heappop(heap)

            if current in visited:
                continue
            visited.add(current)

            if current == destination:
                return path, round(cost, 4)

            for neighbor, edge_weight in self._nodes[current].neighbors.items():
                if neighbor not in visited and neighbor not in self._failed:
                    heapq.heappush(
                        heap,
                        (cost + edge_weight, neighbor, path + [neighbor]),
                    )

        return None, float("inf")

    def edge_weight(self, source: str, target: str) -> Optional[float]:
        """Return the direct edge weight between two nodes, or None if no edge."""
        return self._nodes.get(source, _GraphNode(source)).neighbors.get(target)

    def node_count(self) -> int:
        return len(self._nodes)

    def active_node_count(self) -> int:
        return len(self._nodes) - len(self._failed)
