"""
OAuth 2.0 endpoints — additive authentication extension.

Routes:
    GET  /oauth/url/{provider}       → Returns authorization URL for frontend redirect
    POST /oauth/callback             → Exchange code for MeshEngine JWT

These endpoints do NOT alter any existing auth flows.
Password login (/auth/login) continues to work identically.

Security:
- Client secrets are server-side only — never sent to frontend
- Code exchange happens entirely on the backend
- Issued JWT is identical format to password-auth JWT
- CSRF: redirect_uri is validated against server-side config
"""
from __future__ import annotations

from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.logging import get_logger
from app.services.oauth_service import OAuthService

router = APIRouter(prefix="/oauth", tags=["OAuth"])
logger = get_logger(__name__)
_settings = get_settings()

# ── Scopes per provider ───────────────────────────────────────────────────────

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize"

_GOOGLE_SCOPES = "openid email profile"
_GITHUB_SCOPES = "read:user user:email"


# ── Schemas ───────────────────────────────────────────────────────────────────

class OAuthCallbackRequest(BaseModel):
    provider: str       # "google" | "github"
    code: str           # Authorization code from provider
    redirect_uri: str   # Must match what was used in the auth request


class OAuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class OAuthUrlResponse(BaseModel):
    url: str
    provider: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get(
    "/url/{provider}",
    response_model=OAuthUrlResponse,
    summary="Get OAuth authorization URL",
    description=(
        "Returns the full authorization URL the frontend should redirect to. "
        "Supported providers: `google`, `github`. "
        "The `redirect_uri` used is taken from server configuration to prevent manipulation."
    ),
)
async def get_oauth_url(provider: str) -> OAuthUrlResponse:
    """Build and return the provider authorization URL."""
    redirect_uri = _settings.oauth_redirect_uri

    if provider == "google":
        if not _settings.oauth_google_client_id:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google OAuth is not configured on this server",
            )
        params = {
            "client_id": _settings.oauth_google_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": _GOOGLE_SCOPES,
            "access_type": "online",
            "prompt": "select_account",
        }
        url = f"{_GOOGLE_AUTH_URL}?{urlencode(params)}"

    elif provider == "github":
        if not _settings.oauth_github_client_id:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="GitHub OAuth is not configured on this server",
            )
        params = {
            "client_id": _settings.oauth_github_client_id,
            "redirect_uri": redirect_uri,
            "scope": _GITHUB_SCOPES,
        }
        url = f"{_GITHUB_AUTH_URL}?{urlencode(params)}"

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown provider '{provider}'. Supported: google, github",
        )

    logger.info("oauth_url_requested", provider=provider)
    return OAuthUrlResponse(url=url, provider=provider)


@router.post(
    "/callback",
    response_model=OAuthTokenResponse,
    summary="Exchange OAuth code for MeshEngine JWT",
    description=(
        "Receives the authorization code from the OAuth provider redirect. "
        "Server-side exchanges the code for a provider access token, "
        "fetches the user identity, upserts the User record, "
        "and returns a MeshEngine JWT identical in format to /auth/login."
    ),
)
async def oauth_callback(
    body: OAuthCallbackRequest,
    db: AsyncSession = Depends(get_db),
) -> OAuthTokenResponse:
    """Full server-side OAuth code exchange."""
    provider = body.provider.lower()
    if provider not in ("google", "github"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported provider: {provider}",
        )

    svc = OAuthService(db)
    try:
        token = await svc.exchange_and_authenticate(
            provider=provider,  # type: ignore[arg-type]
            code=body.code,
            redirect_uri=body.redirect_uri,
        )
    except ValueError as exc:
        logger.warning("oauth_exchange_failed", provider=provider, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"OAuth exchange failed: {exc}",
        )
    except Exception as exc:
        logger.error("oauth_unexpected_error", provider=provider, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OAuth provider communication failed. Try again.",
        )

    return OAuthTokenResponse(access_token=token)
