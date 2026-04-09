from datetime import datetime
from pydantic import BaseModel, Field


class NodeCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    x: float
    y: float
    latency_ms: float = Field(default=10.0, gt=0)
    network_id: str


class NodeUpdateRequest(BaseModel):
    x: float | None = None
    y: float | None = None
    latency_ms: float | None = Field(default=None, gt=0)


class NodeDetailResponse(BaseModel):
    id: str
    name: str
    x: float
    y: float
    status: str
    latency_ms: float
    network_id: str
    created_at: datetime

    model_config = {"from_attributes": True}
