"""
OAuth 2.0 service — additive authentication layer.

Handles provider-specific token exchange (Google, GitHub), identity
extraction, user upsert, and MeshEngine JWT issuance.

Design contract:
- Does NOT modify existing User model, auth helpers, or password flows.
- Re-uses create_access_token() from core.auth — same JWT format/secret.
- Upserts users by (provider, provider_user_id) — no collision with
  password-auth accounts unless same email is used deliberately.
- All provider HTTP calls are made server-side — client secrets never leave
  the backend.

Supported providers: google | github
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.user import User

logger = get_logger(__name__)
_settings = get_settings()

Provider = Literal["google", "github"]


# ── Provider endpoints ────────────────────────────────────────────────────────

_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

_GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
_GITHUB_USERINFO_URL = "https://api.github.com/user"
_GITHUB_EMAIL_URL = "https://api.github.com/user/emails"


@dataclass
class OAuthIdentity:
    provider: str
    provider_user_id: str
    email: str
    username: str


# ── Public API ────────────────────────────────────────────────────────────────

class OAuthService:
    """
    Stateless service — one instance per request via FastAPI dependency.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def exchange_and_authenticate(
        self,
        provider: Provider,
        code: str,
        redirect_uri: str,
    ) -> str:
        """
        Full OAuth flow:
        1. Exchange authorization code for provider access token
        2. Fetch user identity from provider
        3. Upsert User record in DB
        4. Return MeshEngine JWT (same format as password login)

        Raises ValueError on invalid provider or failed exchange.
        Returns MeshEngine JWT string.
        """
        identity = await self._fetch_identity(provider, code, redirect_uri)
        user = await self._upsert_user(identity)
        token = create_access_token(user.id, user.username)

        logger.info(
            "oauth_login_success",
            provider=provider,
            user_id=user.id,
            username=user.username,
        )
        return token

    # ── Provider dispatch ─────────────────────────────────────────────────────

    async def _fetch_identity(
        self, provider: Provider, code: str, redirect_uri: str
    ) -> OAuthIdentity:
        if provider == "google":
            return await self._google_identity(code, redirect_uri)
        if provider == "github":
            return await self._github_identity(code, redirect_uri)
        raise ValueError(f"Unsupported OAuth provider: {provider}")

    # ── Google ────────────────────────────────────────────────────────────────

    async def _google_identity(self, code: str, redirect_uri: str) -> OAuthIdentity:
        async with httpx.AsyncClient(timeout=10.0) as client:
            token_resp = await client.post(
                _GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": _settings.oauth_google_client_id,
                    "client_secret": _settings.oauth_google_client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            token_resp.raise_for_status()
            access_token = token_resp.json().get("access_token")
            if not access_token:
                raise ValueError("Google token exchange returned no access_token")

            user_resp = await client.get(
                _GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            user_resp.raise_for_status()
            info = user_resp.json()

        provider_id = info.get("sub")
        email = info.get("email", "")
        name = info.get("name") or info.get("email", "google_user")
        username = _sanitize_username(name)

        logger.info("google_identity_fetched", provider_id=provider_id, email=email)
        return OAuthIdentity(
            provider="google",
            provider_user_id=str(provider_id),
            email=email,
            username=username,
        )

    # ── GitHub ────────────────────────────────────────────────────────────────

    async def _github_identity(self, code: str, redirect_uri: str) -> OAuthIdentity:
        async with httpx.AsyncClient(timeout=10.0) as client:
            token_resp = await client.post(
                _GITHUB_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": _settings.oauth_github_client_id,
                    "client_secret": _settings.oauth_github_client_secret,
                    "redirect_uri": redirect_uri,
                },
                headers={"Accept": "application/json"},
            )
            token_resp.raise_for_status()
            access_token = token_resp.json().get("access_token")
            if not access_token:
                raise ValueError("GitHub token exchange returned no access_token")

            user_resp = await client.get(
                _GITHUB_USERINFO_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            user_resp.raise_for_status()
            info = user_resp.json()

            # GitHub may hide email — fetch verified primary email separately
            email = info.get("email") or ""
            if not email:
                email_resp = await client.get(
                    _GITHUB_EMAIL_URL,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/vnd.github+json",
                    },
                )
                if email_resp.status_code == 200:
                    emails = email_resp.json()
                    primary = next(
                        (e["email"] for e in emails if e.get("primary") and e.get("verified")),
                        None,
                    )
                    email = primary or ""

        provider_id = info.get("id")
        login = info.get("login") or "github_user"
        username = _sanitize_username(login)

        logger.info("github_identity_fetched", provider_id=provider_id, login=login)
        return OAuthIdentity(
            provider="github",
            provider_user_id=str(provider_id),
            email=email,
            username=username,
        )

    # ── User upsert ───────────────────────────────────────────────────────────

    async def _upsert_user(self, identity: OAuthIdentity) -> User:
        """
        Find existing user by provider+provider_user_id OR email.
        Create new user if not found.
        Never overwrites password-auth users' passwords.
        """
        # Look up by provider identity stored in username prefix convention:
        # oauth_{provider}_{provider_user_id}
        oauth_marker = f"oauth_{identity.provider}_{identity.provider_user_id}"

        result = await self.db.execute(
            select(User).where(User.username == oauth_marker)
        )
        user = result.scalar_one_or_none()

        if user is None:
            # Check by email to link existing password-auth account
            if identity.email:
                result = await self.db.execute(
                    select(User).where(User.email == identity.email)
                )
                user = result.scalar_one_or_none()

        if user is None:
            # Create new OAuth user — password field is unusable (random hash)
            user = User(
                id=str(uuid.uuid4()),
                username=oauth_marker,
                email=identity.email or f"{oauth_marker}@noemail.mesh",
                hashed_password=f"oauth_no_password_{uuid.uuid4().hex}",
            )
            self.db.add(user)
            await self.db.commit()
            await self.db.refresh(user)
            logger.info(
                "oauth_user_created",
                user_id=user.id,
                provider=identity.provider,
            )
        else:
            logger.info(
                "oauth_user_found",
                user_id=user.id,
                provider=identity.provider,
            )

        return user


# ── Utilities ─────────────────────────────────────────────────────────────────

def _sanitize_username(raw: str) -> str:
    """Convert display name to safe username (alphanumeric + underscore, max 30)."""
    import re
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", raw)
    return cleaned[:30] or "mesh_user"
