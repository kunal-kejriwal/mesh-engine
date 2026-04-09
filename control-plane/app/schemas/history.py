from datetime import datetime
from pydantic import BaseModel


class HistoryResponse(BaseModel):
    id: str
    user_id: str
    action: str
    node_id: str | None
    detail: str | None
    timestamp: datetime

    model_config = {"from_attributes": True}
