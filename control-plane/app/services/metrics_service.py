"""
MetricsService — Redis-backed real-time observability counters.

Design rationale:
- Redis INCR / INCRBYFLOAT are atomic — no locking required under concurrent load.
- Metrics survive in-process restarts (Redis persists them).
- All write methods are fire-and-forget: they log on failure but never propagate
  exceptions into request handlers. Metrics are best-effort.
- Read methods may raise — callers should handle RedisError for graceful degradation.

Key schema (no colons in UUID values, so split-by-colon parsing is safe):
    mesh:metrics:global:total          INT
    mesh:metrics:global:success        INT
    mesh:metrics:global:failed         INT
    mesh:metrics:global:reroutes       INT
    mesh:metrics:global:latency_sum    FLOAT (stored as string by INCRBYFLOAT)
    mesh:metrics:global:latency_count  INT

    mesh:metrics:net:{network_id}:total
    mesh:metrics:net:{network_id}:success
    mesh:metrics:net:{network_id}:failed
    mesh:metrics:net:{network_id}:latency_sum
    mesh:metrics:net:{network_id}:latency_count
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict

from app.core.logging import get_logger
from app.core.redis_client import get_redis

logger = get_logger(__name__)

_G = "mesh:metrics:global"
_N = "mesh:metrics:net"


@dataclass
class NetworkMetrics:
    network_id: str
    total_messages: int
    successful_deliveries: int
    failed_deliveries: int
    success_rate: float
    avg_latency_ms: float


@dataclass
class GlobalMetrics:
    total_messages: int
    successful_deliveries: int
    failed_deliveries: int
    success_rate: float
    avg_latency_ms: float
    total_reroutes: int
    per_network: Dict[str, NetworkMetrics] = field(default_factory=dict)


class MetricsService:

    # ------------------------------------------------------------------ #
    # Write operations (fire-and-forget, never raise)                     #
    # ------------------------------------------------------------------ #

    async def record_message_sent(self, network_id: str) -> None:
        await self._pipeline(
            ("incr", f"{_G}:total"),
            ("incr", f"{_N}:{network_id}:total"),
        )

    async def record_delivery_success(self, network_id: str, latency_ms: float) -> None:
        try:
            redis = await get_redis()
            async with redis.pipeline(transaction=False) as pipe:
                pipe.incr(f"{_G}:success")
                pipe.incrbyfloat(f"{_G}:latency_sum", latency_ms)
                pipe.incr(f"{_G}:latency_count")
                pipe.incr(f"{_N}:{network_id}:success")
                pipe.incrbyfloat(f"{_N}:{network_id}:latency_sum", latency_ms)
                pipe.incr(f"{_N}:{network_id}:latency_count")
                await pipe.execute()
        except Exception as exc:
            logger.warning("metrics_write_failed", op="success", error=str(exc))

    async def record_delivery_failure(self, network_id: str) -> None:
        await self._pipeline(
            ("incr", f"{_G}:failed"),
            ("incr", f"{_N}:{network_id}:failed"),
        )

    async def record_reroute(self) -> None:
        await self._pipeline(("incr", f"{_G}:reroutes"))

    # ------------------------------------------------------------------ #
    # Read operations (may raise — callers handle gracefully)             #
    # ------------------------------------------------------------------ #

    async def get_global_metrics(self) -> GlobalMetrics:
        redis = await get_redis()

        vals = await redis.mget(
            f"{_G}:total",
            f"{_G}:success",
            f"{_G}:failed",
            f"{_G}:reroutes",
            f"{_G}:latency_sum",
            f"{_G}:latency_count",
        )
        total, success, failed, reroutes, lat_sum, lat_cnt = (
            float(v or 0) for v in vals
        )

        avg_lat = (lat_sum / lat_cnt) if lat_cnt > 0 else 0.0
        success_rate = (success / total) if total > 0 else 0.0

        # Discover per-network entries via SCAN (avoids blocking KEYS on large sets)
        per_network: Dict[str, NetworkMetrics] = {}
        async for key in redis.scan_iter(f"{_N}:*:total"):
            parts = key.split(":")
            # key = mesh:metrics:net:{uuid}:total → parts[3] = uuid
            if len(parts) == 5:
                network_id = parts[3]
                try:
                    per_network[network_id] = await self.get_network_metrics(network_id)
                except Exception:
                    pass  # skip a single failing network

        return GlobalMetrics(
            total_messages=int(total),
            successful_deliveries=int(success),
            failed_deliveries=int(failed),
            success_rate=round(success_rate, 4),
            avg_latency_ms=round(avg_lat, 2),
            total_reroutes=int(reroutes),
            per_network=per_network,
        )

    async def get_network_metrics(self, network_id: str) -> NetworkMetrics:
        redis = await get_redis()
        vals = await redis.mget(
            f"{_N}:{network_id}:total",
            f"{_N}:{network_id}:success",
            f"{_N}:{network_id}:failed",
            f"{_N}:{network_id}:latency_sum",
            f"{_N}:{network_id}:latency_count",
        )
        total, success, failed, lat_sum, lat_cnt = (float(v or 0) for v in vals)
        avg_lat = (lat_sum / lat_cnt) if lat_cnt > 0 else 0.0
        success_rate = (success / total) if total > 0 else 0.0

        return NetworkMetrics(
            network_id=network_id,
            total_messages=int(total),
            successful_deliveries=int(success),
            failed_deliveries=int(failed),
            success_rate=round(success_rate, 4),
            avg_latency_ms=round(avg_lat, 2),
        )

    async def reset(self) -> None:
        """Wipe all metrics — intended for test teardown only."""
        redis = await get_redis()
        keys = [k async for k in redis.scan_iter("mesh:metrics:*")]
        if keys:
            await redis.delete(*keys)

    # ------------------------------------------------------------------ #
    # Internals                                                            #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def _pipeline(*ops: tuple[str, str]) -> None:
        """Execute a sequence of (command, key) pairs in a single pipeline."""
        try:
            redis = await get_redis()
            async with redis.pipeline(transaction=False) as pipe:
                for cmd, key in ops:
                    getattr(pipe, cmd)(key)
                await pipe.execute()
        except Exception as exc:
            logger.warning("metrics_pipeline_failed", error=str(exc))
