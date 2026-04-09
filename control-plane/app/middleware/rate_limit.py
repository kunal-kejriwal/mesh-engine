"""
Redis-based IP rate limiting middleware.

Strategy: sliding fixed-window counter per IP.
Default: 10 requests per 60 seconds per IP.

Works by incrementing a Redis key `rl:<ip>` on every request.
The key expires after the window duration, so the counter resets automatically.
"""
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.redis_client import get_redis
from app.core.config import get_settings

_settings = get_settings()


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_requests: int = 10, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds

    async def dispatch(self, request: Request, call_next) -> Response:
        # Skip rate limiting for health and root
        if request.url.path in ("/health", "/", "/docs", "/redoc", "/openapi.json"):
            return await call_next(request)

        client_ip = self._get_client_ip(request)
        redis = await get_redis()
        key = f"rl:{client_ip}"

        try:
            count = await redis.incr(key)
            if count == 1:
                # First request in window — set expiry
                await redis.expire(key, self.window_seconds)

            remaining = max(0, self.max_requests - count)
            response = await call_next(request)
            response.headers["X-RateLimit-Limit"] = str(self.max_requests)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
            response.headers["X-RateLimit-Window"] = str(self.window_seconds)

            if count > self.max_requests:
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": "RATE_LIMIT_EXCEEDED",
                        "message": f"Too many requests. Retry after {self.window_seconds}s.",
                    },
                    headers={
                        "X-RateLimit-Limit": str(self.max_requests),
                        "X-RateLimit-Remaining": "0",
                        "Retry-After": str(self.window_seconds),
                    },
                )

            return response

        except Exception:
            # If Redis is unavailable, fail open (don't block requests)
            return await call_next(request)

    @staticmethod
    def _get_client_ip(request: Request) -> str:
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        if request.client:
            return request.client.host
        return "unknown"
