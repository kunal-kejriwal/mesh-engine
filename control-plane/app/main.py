"""
MeshEngine — Control Plane entry point.

Starts the FastAPI application, initialises the database schema on first boot,
registers all API routers, and wires up global exception handling.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import os

from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.api import message, metrics, network, node, simulation, websocket, auth, nodes, history, oauth, lab
from app.middleware.rate_limit import RateLimitMiddleware
from app.core.config import get_settings
from app.core.connection_manager import get_connection_manager
from app.core.database import create_tables
from app.core.exceptions import MeshEngineException
from app.core.logging import configure_logging, get_logger
from app.core.redis_client import close_redis

settings = get_settings()
configure_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "meshengine_startup",
        service="control_plane",
        version=settings.version,
    )
    await create_tables()
    logger.info("database_tables_ready")
    # Eagerly initialise the connection manager so it's ready before first request
    get_connection_manager()
    logger.info("connection_manager_ready")
    yield
    await close_redis()
    logger.info("meshengine_shutdown")


app = FastAPI(
    title="MeshEngine — Distributed Mesh Network Simulation Platform",
    description=(
        "Simulates a self-healing drone mesh network. "
        "Route messages, inject failures, and watch the network recover in real time."
    ),
    version=settings.version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    RateLimitMiddleware,
    max_requests=settings.rate_limit_requests,
    window_seconds=settings.rate_limit_window_seconds,
)


# ── Global domain exception handler ─────────────────────────────────────────

@app.exception_handler(MeshEngineException)
async def mesh_exception_handler(request: Request, exc: MeshEngineException) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"error": exc.code, "message": exc.message},
    )


# ── Routers ──────────────────────────────────────────────────────────────────

app.include_router(network.router)
app.include_router(node.router)
app.include_router(message.router)
app.include_router(simulation.router)
app.include_router(metrics.router)
app.include_router(websocket.router)
app.include_router(auth.router)
app.include_router(nodes.router)
app.include_router(history.router)
app.include_router(oauth.router)
app.include_router(lab.router)


# ── Dashboard (static HTML) ───────────────────────────────────────────────────

_DASHBOARD_PATH = os.path.join(os.path.dirname(__file__), "..", "dashboard", "index.html")


@app.get("/dashboard", response_class=HTMLResponse, tags=["Dashboard"], include_in_schema=False)
async def dashboard() -> HTMLResponse:
    """Serve the MeshEngine real-time visualization dashboard."""
    try:
        with open(_DASHBOARD_PATH, encoding="utf-8") as fh:
            return HTMLResponse(content=fh.read())
    except FileNotFoundError:
        return HTMLResponse(
            content="<h1>Dashboard not found</h1><p>Ensure dashboard/index.html exists.</p>",
            status_code=404,
        )


# ── Health & info ────────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"])
async def health_check():
    mgr = get_connection_manager()
    return {
        "status": "healthy",
        "service": "MeshEngine Control Plane",
        "version": settings.version,
        "ws_clients": mgr.client_count,
    }


@app.get("/", tags=["Health"])
async def root():
    return {
        "service": "MeshEngine",
        "docs": "/docs",
        "dashboard": "/dashboard",
        "health": "/health",
        "websocket_simulation": "ws://localhost:8000/ws/simulation",
        "websocket_stream": "ws://localhost:8000/ws/stream",
        "metrics": "/metrics",
    }
