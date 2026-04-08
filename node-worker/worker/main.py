"""
Node Worker entry point.

Boots the NodeWorker, wires up OS signal handlers for graceful shutdown,
and runs the async event loop.
"""
import asyncio
import logging
import os
import signal

from worker.node_worker import NodeWorker

# ── Logging setup ─────────────────────────────────────────────────────────────
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("node_worker.main")


async def main() -> None:
    worker = NodeWorker()

    loop = asyncio.get_running_loop()

    def _shutdown(signum, frame):
        logger.info("Received signal %s — shutting down.", signum)
        worker.stop()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    logger.info("MeshEngine NodeWorker starting — id=%s", worker.worker_id)
    await worker.run()
    logger.info("MeshEngine NodeWorker exited.")


if __name__ == "__main__":
    asyncio.run(main())
