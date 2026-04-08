from pydantic import BaseModel


class NodeResponse(BaseModel):
    id: str
    name: str
    x: float
    y: float
    status: str
    latency_ms: float

    model_config = {"from_attributes": True}
