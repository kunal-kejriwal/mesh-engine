import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import String, Float, DateTime, JSON, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    network_id: Mapped[str] = mapped_column(
        String, ForeignKey("networks.id", ondelete="CASCADE"), nullable=False
    )
    source_id: Mapped[str] = mapped_column(String, nullable=False)
    destination_id: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[str] = mapped_column(String, nullable=False)

    # Trace — links this message to a simulation run or standalone send
    trace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    # Routing outcome
    status: Mapped[str] = mapped_column(
        String, default="PENDING"
    )  # PENDING | DELIVERED | FAILED
    path: Mapped[list[Any]] = mapped_column(JSON, default=list)
    hops_completed: Mapped[int] = mapped_column(Integer, default=0)
    total_latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    hop_log: Mapped[list[Any]] = mapped_column(JSON, default=list)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    delivered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    network: Mapped["Network"] = relationship(  # type: ignore[name-defined]
        "Network", back_populates="messages"
    )
