import uuid
from datetime import datetime

from sqlalchemy import String, Float, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Network(Base):
    __tablename__ = "networks"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    link_threshold: Mapped[float] = mapped_column(Float, default=150.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    nodes: Mapped[list["Node"]] = relationship(  # type: ignore[name-defined]
        "Node", back_populates="network", cascade="all, delete-orphan"
    )
    links: Mapped[list["Link"]] = relationship(  # type: ignore[name-defined]
        "Link", back_populates="network", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(  # type: ignore[name-defined]
        "Message", back_populates="network", cascade="all, delete-orphan"
    )
