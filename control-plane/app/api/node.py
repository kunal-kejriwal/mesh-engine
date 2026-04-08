from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import NodeNotFoundException
from app.schemas.node import NodeResponse
from app.services.network_service import NetworkService

router = APIRouter(prefix="/node", tags=["Node"])


def _svc(db: AsyncSession = Depends(get_db)) -> NetworkService:
    return NetworkService(db)


@router.post(
    "/fail/{node_id}",
    response_model=NodeResponse,
    summary="Mark a node as DOWN",
    description=(
        "Injects a node failure. The node is marked DOWN in the DB. "
        "All subsequent routing calls will exclude this node from path computation. "
        "Use /node/recover/{node_id} to restore it."
    ),
)
async def fail_node(
    node_id: str,
    svc: NetworkService = Depends(_svc),
) -> NodeResponse:
    try:
        return await svc.fail_node(node_id)
    except NodeNotFoundException as exc:
        raise HTTPException(status_code=404, detail={"error": exc.code, "message": exc.message})


@router.post(
    "/recover/{node_id}",
    response_model=NodeResponse,
    summary="Recover a failed node",
    description="Re-admits a DOWN node to the routing graph. Future routes may use it again.",
)
async def recover_node(
    node_id: str,
    svc: NetworkService = Depends(_svc),
) -> NodeResponse:
    try:
        return await svc.recover_node(node_id)
    except NodeNotFoundException as exc:
        raise HTTPException(status_code=404, detail={"error": exc.code, "message": exc.message})
