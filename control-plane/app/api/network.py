from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import NetworkNotFoundException
from app.schemas.network import NetworkCreate, NetworkResponse, NetworkStateResponse
from app.services.network_service import NetworkService

router = APIRouter(prefix="/network", tags=["Network"])


def _svc(db: AsyncSession = Depends(get_db)) -> NetworkService:
    return NetworkService(db)


@router.post(
    "/create",
    response_model=NetworkResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a mesh network",
    description=(
        "Provision N drone nodes with (x, y) coordinates. "
        "Links are auto-generated for every node pair within `link_threshold` Euclidean distance. "
        "Edge weight = distance × 0.5 ms."
    ),
)
async def create_network(
    data: NetworkCreate,
    svc: NetworkService = Depends(_svc),
) -> NetworkResponse:
    network = await svc.create_network(data)
    return network


@router.get(
    "/state/{network_id}",
    response_model=NetworkStateResponse,
    summary="Get live network state",
)
async def get_network_state(
    network_id: str,
    svc: NetworkService = Depends(_svc),
) -> NetworkStateResponse:
    try:
        return await svc.get_network_state(network_id)
    except NetworkNotFoundException as exc:
        raise HTTPException(status_code=404, detail={"error": exc.code, "message": exc.message})


@router.get("/list", summary="List all networks")
async def list_networks(svc: NetworkService = Depends(_svc)):
    networks = await svc.list_networks()
    return [
        {
            "id": n.id,
            "name": n.name,
            "node_count": len(n.nodes),
            "link_count": len(n.links),
            "active_nodes": sum(1 for nd in n.nodes if nd.status == "UP"),
        }
        for n in networks
    ]
