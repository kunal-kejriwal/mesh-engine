import uuid
from datetime import datetime

from sqlalchemy import String, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Link(Base):
    __tablename__ = "links"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    network_id: Mapped[str] = mapped_column(
        String, ForeignKey("networks.id", ondelete="CASCADE"), nullable=False
    )
    source_id: Mapped[str] = mapped_column(
        String, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False
    )
    target_id: Mapped[str] = mapped_column(
        String, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False
    )
    weight: Mapped[float] = mapped_column(Float, nullable=False)  # latency in ms
    bidirectional: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    network: Mapped["Network"] = relationship(  # type: ignore[name-defined]
        "Network", back_populates="links"
    )
    source: Mapped["Node"] = relationship(  # type: ignore[name-defined]
        "Node", foreign_keys=[source_id], back_populates="outgoing_links"
    )
    target: Mapped["Node"] = relationship(  # type: ignore[name-defined]
        "Node", foreign_keys=[target_id], back_populates="incoming_links"
    )
