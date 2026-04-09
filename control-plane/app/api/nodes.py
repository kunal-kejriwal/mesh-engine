"""
Authenticated node management CRUD.
All routes require a valid JWT (get_current_user dependency).
Actions are logged to action_history.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.node import Node
from app.models.user import User
from app.schemas.nodes import NodeCreateRequest, NodeUpdateRequest, NodeDetailResponse
from app.api.history import log_action

router = APIRouter(prefix="/nodes", tags=["Node Management"])


def _auth(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.get(
    "",
    response_model=list[NodeDetailResponse],
    summary="List all nodes (auth required)",
)
async def list_nodes(
    _: User = Depends(_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Node).order_by(Node.created_at.desc()))
    return result.scalars().all()


@router.post(
    "",
    response_model=NodeDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a node in an existing network (auth required)",
)
async def create_node(
    data: NodeCreateRequest,
    current_user: User = Depends(_auth),
    db: AsyncSession = Depends(get_db),
):
    node = Node(
        name=data.name,
        x=data.x,
        y=data.y,
        latency_ms=data.latency_ms,
        network_id=data.network_id,
    )
    db.add(node)
    await db.commit()
    await db.refresh(node)
    await log_action(db, current_user.id, "node_created", node.id, f"name={data.name}")
    return node


@router.put(
    "/{node_id}",
    response_model=NodeDetailResponse,
    summary="Update node coordinates / latency (auth required)",
)
async def update_node(
    node_id: str,
    data: NodeUpdateRequest,
    current_user: User = Depends(_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    if data.x is not None:
        node.x = data.x
    if data.y is not None:
        node.y = data.y
    if data.latency_ms is not None:
        node.latency_ms = data.latency_ms

    await db.commit()
    await db.refresh(node)
    await log_action(db, current_user.id, "node_updated", node_id)
    return node


@router.delete(
    "/{node_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a node (auth required)",
)
async def delete_node(
    node_id: str,
    current_user: User = Depends(_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    await db.delete(node)
    await db.commit()
    await log_action(db, current_user.id, "node_deleted", node_id)


@router.post(
    "/{node_id}/block",
    response_model=NodeDetailResponse,
    summary="Block (DOWN) a node (auth required)",
)
async def block_node(
    node_id: str,
    current_user: User = Depends(_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    node.status = "DOWN"
    await db.commit()
    await db.refresh(node)
    await log_action(db, current_user.id, "node_blocked", node_id)
    return node


@router.post(
    "/{node_id}/start",
    response_model=NodeDetailResponse,
    summary="Start (UP) a node (auth required)",
)
async def start_node(
    node_id: str,
    current_user: User = Depends(_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    node.status = "UP"
    await db.commit()
    await db.refresh(node)
    await log_action(db, current_user.id, "node_started", node_id)
    return node
