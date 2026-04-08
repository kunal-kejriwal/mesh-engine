"""
Network service — owns the Control Plane's topology management.

Responsibilities:
- Create networks with auto-generated distance-threshold links
- Expose current network state
- Inject and recover node failures
- Publish topology-change events to Redis
"""
from __future__ import annotations

import math
import uuid
from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.events import emit_event
from app.core.exceptions import NetworkNotFoundException, NodeNotFoundException
from app.core.logging import get_logger
from app.models.link import Link
from app.models.network import Network
from app.models.node import Node
from app.schemas.network import NetworkCreate, NetworkStateResponse

logger = get_logger(__name__)


class NetworkService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------ #
    # Network creation                                                     #
    # ------------------------------------------------------------------ #

    async def create_network(self, data: NetworkCreate) -> Network:
        """
        Create a network with N nodes and auto-generate bidirectional links
        for every node pair whose Euclidean distance ≤ link_threshold.
        Edge weight = distance × latency_distance_factor (default 0.5 ms/unit).
        """
        from app.core.config import get_settings

        settings = get_settings()
        network_id = str(uuid.uuid4())

        network = Network(
            id=network_id,
            name=data.name,
            link_threshold=data.link_threshold,
        )
        self.db.add(network)
        await self.db.flush()

        # Persist nodes
        db_nodes: List[Node] = []
        for nd in data.nodes:
            node = Node(
                id=str(uuid.uuid4()),
                network_id=network_id,
                name=nd.name,
                x=nd.x,
                y=nd.y,
                latency_ms=nd.latency_ms,
                status="UP",
            )
            self.db.add(node)
            db_nodes.append(node)

        await self.db.flush()

        # Auto-generate links — O(n²) pair scan
        links_created = 0
        for i, n1 in enumerate(db_nodes):
            for j, n2 in enumerate(db_nodes):
                if j <= i:
                    continue
                distance = math.sqrt((n2.x - n1.x) ** 2 + (n2.y - n1.y) ** 2)
                if distance <= data.link_threshold:
                    weight = round(distance * settings.latency_distance_factor, 2)
                    link = Link(
                        id=str(uuid.uuid4()),
                        network_id=network_id,
                        source_id=n1.id,
                        target_id=n2.id,
                        weight=weight,
                        bidirectional=True,
                    )
                    self.db.add(link)
                    links_created += 1

        await self.db.commit()

        logger.info(
            "network_created",
            network_id=network_id,
            name=data.name,
            nodes=len(db_nodes),
            links=links_created,
            threshold=data.link_threshold,
        )

        return await self._load_network(network_id)

    # ------------------------------------------------------------------ #
    # Queries                                                              #
    # ------------------------------------------------------------------ #

    async def get_network_state(self, network_id: str) -> NetworkStateResponse:
        network = await self._load_network(network_id)
        active = sum(1 for n in network.nodes if n.status == "UP")

        return NetworkStateResponse(
            network_id=network_id,
            node_count=len(network.nodes),
            active_nodes=active,
            down_nodes=len(network.nodes) - active,
            link_count=len(network.links),
            nodes=network.nodes,
            links=network.links,
        )

    async def list_networks(self) -> List[Network]:
        result = await self.db.execute(
            select(Network).options(
                selectinload(Network.nodes),
                selectinload(Network.links),
            )
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------ #
    # Node lifecycle                                                       #
    # ------------------------------------------------------------------ #

    async def fail_node(self, node_id: str) -> Node:
        node = await self._get_node(node_id)
        node.status = "DOWN"
        await self.db.commit()

        await emit_event("node", {
            "event_type": "NODE_DOWN",
            "node_id": node.id,
            "node_name": node.name,
            "network_id": node.network_id,
            "status": "DOWN",
        })
        logger.warning("node_failed", node_id=node_id, name=node.name)
        return node

    async def recover_node(self, node_id: str) -> Node:
        node = await self._get_node(node_id)
        node.status = "UP"
        await self.db.commit()

        await emit_event("node", {
            "event_type": "NODE_RECOVERED",
            "node_id": node.id,
            "node_name": node.name,
            "network_id": node.network_id,
            "status": "UP",
        })
        logger.info("node_recovered", node_id=node_id, name=node.name)
        return node

    # ------------------------------------------------------------------ #
    # Internals                                                            #
    # ------------------------------------------------------------------ #

    async def _load_network(self, network_id: str) -> Network:
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
        return network

    async def _get_node(self, node_id: str) -> Node:
        result = await self.db.execute(select(Node).where(Node.id == node_id))
        node = result.scalar_one_or_none()
        if not node:
            raise NodeNotFoundException(node_id)
        return node

