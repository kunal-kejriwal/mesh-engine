from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import (
    MessageNotFoundException,
    NetworkNotFoundException,
    NodeNotFoundException,
    NoRouteException,
)
from app.schemas.message import MessageResponse, MessageSend, MessageTrace
from app.services.message_service import MessageService

router = APIRouter(prefix="/message", tags=["Message"])


def _svc(db: AsyncSession = Depends(get_db)) -> MessageService:
    return MessageService(db)


@router.post(
    "/send",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Send a message through the mesh",
    description=(
        "Routes a message from source → destination using Dijkstra's algorithm.\n\n"
        "Emits `MESSAGE_SENT`, `MESSAGE_HOP` (per hop), and `MESSAGE_DELIVERED` events "
        "to all WebSocket clients and Redis pub/sub channels.\n\n"
        "Returns 409 if the network is partitioned and no path exists."
    ),
)
async def send_message(
    data: MessageSend,
    svc: MessageService = Depends(_svc),
) -> MessageResponse:
    try:
        return await svc.send_message(data)
    except NoRouteException as exc:
        raise HTTPException(
            status_code=409,
            detail={"error": exc.code, "message": exc.message},
        )
    except (NodeNotFoundException, NetworkNotFoundException) as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": exc.code, "message": exc.message},
        )


@router.get(
    "/{message_id}/trace",
    response_model=MessageTrace,
    summary="Full message lifecycle trace",
    description=(
        "Returns the complete, enriched trace for a message:\n\n"
        "- Node names resolved for every hop\n"
        "- Per-hop and cumulative latency\n"
        "- Timing summary (first hop, last hop, total duration)\n"
        "- `trace_id` linking back to the originating simulation (if any)\n\n"
        "Use this for deep post-hoc analysis of routing decisions."
    ),
)
async def get_message_trace(
    message_id: str,
    svc: MessageService = Depends(_svc),
) -> MessageTrace:
    try:
        return await svc.get_trace(message_id)
    except MessageNotFoundException as exc:
        raise HTTPException(status_code=404, detail={"error": exc.code, "message": exc.message})


@router.get(
    "/{message_id}",
    response_model=MessageResponse,
    summary="Retrieve a message by ID",
    description="Returns a previously sent message with its complete routing history.",
)
async def get_message(
    message_id: str,
    svc: MessageService = Depends(_svc),
) -> MessageResponse:
    try:
        return await svc.get_message(message_id)
    except MessageNotFoundException as exc:
        raise HTTPException(status_code=404, detail={"error": exc.code, "message": exc.message})
