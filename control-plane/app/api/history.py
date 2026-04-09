from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.history import ActionHistory
from app.schemas.history import HistoryResponse

router = APIRouter(prefix="/history", tags=["History"])


@router.get(
    "",
    response_model=list[HistoryResponse],
    summary="Get action history for the current user",
)
async def get_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ActionHistory)
        .where(ActionHistory.user_id == current_user.id)
        .order_by(ActionHistory.timestamp.desc())
        .limit(200)
    )
    return result.scalars().all()


async def log_action(
    db: AsyncSession,
    user_id: str,
    action: str,
    node_id: str | None = None,
    detail: str | None = None,
) -> None:
    """Helper used by other routes to append an audit entry."""
    entry = ActionHistory(
        user_id=user_id,
        action=action,
        node_id=node_id,
        detail=detail,
    )
    db.add(entry)
    await db.commit()
