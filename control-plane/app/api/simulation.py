from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import NetworkNotFoundException, NodeNotFoundException
from app.schemas.simulation import SimulationResult, SimulationStart
from app.services.simulation_service import SimulationService

router = APIRouter(prefix="/simulation", tags=["Simulation"])


def _svc(db: AsyncSession = Depends(get_db)) -> SimulationService:
    return SimulationService(db)


@router.post(
    "/start",
    response_model=SimulationResult,
    summary="Run a full mesh simulation",
    description=(
        "Orchestrates a complete simulation scenario:\n\n"
        "1. Compute initial shortest path (Dijkstra)\n"
        "2. Inject node failures (optional `fail_nodes` list)\n"
        "3. Automatically recompute route — self-healing\n"
        "4. Deliver message on final path\n"
        "5. Stream all phase events over Redis/WebSocket\n\n"
        "Returns initial path, final path, reroute decision, and full message ID."
    ),
)
async def start_simulation(
    data: SimulationStart,
    svc: SimulationService = Depends(_svc),
) -> SimulationResult:
    try:
        return await svc.run(data)
    except (NetworkNotFoundException, NodeNotFoundException) as exc:
        raise HTTPException(status_code=404, detail={"error": exc.code, "message": exc.message})
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": "SIMULATION_ERROR", "message": str(exc)})
