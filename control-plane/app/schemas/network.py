from __future__ import annotations

from datetime import datetime
from typing import List

from pydantic import BaseModel, Field


class NodeCreate(BaseModel):
    name: str
    x: float
    y: float
    latency_ms: float = Field(default=10.0, gt=0)


class NetworkCreate(BaseModel):
    name: str
    nodes: List[NodeCreate] = Field(min_length=2)
    link_threshold: float = Field(default=150.0, gt=0, description="Max Euclidean distance for auto-link")


class LinkResponse(BaseModel):
    id: str
    source_id: str
    target_id: str
    weight: float
    bidirectional: bool

    model_config = {"from_attributes": True}


class NodeResponse(BaseModel):
    id: str
    name: str
    x: float
    y: float
    status: str
    latency_ms: float

    model_config = {"from_attributes": True}


class NetworkResponse(BaseModel):
    id: str
    name: str
    link_threshold: float
    nodes: List[NodeResponse]
    links: List[LinkResponse]
    created_at: datetime

    model_config = {"from_attributes": True}


class NetworkStateResponse(BaseModel):
    network_id: str
    node_count: int
    active_nodes: int
    down_nodes: int
    link_count: int
    nodes: List[NodeResponse]
    links: List[LinkResponse]

    model_config = {"from_attributes": True}
