"""
Routing service — wraps Dijkstra graph construction from live DB state.

Each call to compute_route() rebuilds the graph fresh from PostgreSQL so
that node failures committed since the last call are automatically reflected.
This is intentional: the routing service is stateless with respect to
topology — the DB is the single source of truth.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NetworkNotFoundException, NoRouteException
from app.core.logging import get_logger
from app.engine.dijkstra import MeshGraph
from app.models.link import Link
from app.models.network import Network
from app.models.node import Node
from app.schemas.message import RouteInfo

logger = get_logger(__name__)


class RoutingService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def compute_route(
        self,
        network_id: str,
        source_id: str,
        destination_id: str,
    ) -> RouteInfo:
        """
        Build a fresh MeshGraph from DB state, run Dijkstra, and return
        the shortest path with cumulative latency and hop count.

        Raises NoRouteException when the destination is unreachable
        (e.g., network is partitioned due to node failures).
        """
        graph = await self._build_graph(network_id)
        path, total_cost = graph.dijkstra(source_id, destination_id)

        if path is None:
            raise NoRouteException(source_id, destination_id)

        route = RouteInfo(
            path=path,
            total_latency_ms=total_cost,
            hop_count=len(path) - 1,
        )

        logger.info(
            "route_computed",
            network_id=network_id,
            source=source_id,
            destination=destination_id,
            path=path,
            latency_ms=total_cost,
            hops=route.hop_count,
        )

        return route

    async def build_graph_for_network(self, network_id: str) -> MeshGraph:
        """Public helper — returns the graph for inspection/testing."""
        return await self._build_graph(network_id)

    # ------------------------------------------------------------------ #
    # Internals                                                            #
    # ------------------------------------------------------------------ #

    async def _build_graph(self, network_id: str) -> MeshGraph:
        result = await self.db.execute(
            select(Network)
            .options(
                selectinload(Network.nodes),
                selectinload(Network.links),
            )
            .where(Network.id == network_id)
        )
        network = result.scalar_one_or_none()
        if not network:
            raise NetworkNotFoundException(network_id)

        graph = MeshGraph()

        for node in network.nodes:
            graph.add_node(node.id)
            if node.status == "DOWN":
                graph.fail_node(node.id)

        for link in network.links:
            graph.add_edge(
                link.source_id,
                link.target_id,
                link.weight,
                link.bidirectional,
            )

        return graph

    async def get_link_weight_map(self, network_id: str) -> dict[tuple[str, str], float]:
        """Returns {(source_id, target_id): weight} including reverse direction."""
        result = await self.db.execute(
            select(Link).where(Link.network_id == network_id)
        )
        links = result.scalars().all()
        weights: dict[tuple[str, str], float] = {}
        for lnk in links:
            weights[(lnk.source_id, lnk.target_id)] = lnk.weight
            if lnk.bidirectional:
                weights[(lnk.target_id, lnk.source_id)] = lnk.weight
        return weights
