"""
ZET OAuth 2.1 Authorization Server for MCP.

Lets an MCP client connect with just the MCP URL: the client self-registers
(Dynamic Client Registration), opens ZET's login/consent page in the browser,
the user logs into ZET, and the client receives a token — no copy-pasting.

All OAuth state (clients, pending requests, auth codes, refresh tokens) is
persisted in the database so the flow survives server reloads/restarts and works
across workers. Issued access tokens are ZET personal access tokens (PATs), so
the resource side (`verify_token`) reuses the same validation and tokens are
revocable.
"""

import json
import logging
import os
import secrets
import time
from datetime import datetime, timezone

from fastmcp.server.auth import AccessToken, OAuthProvider
from fastmcp.server.auth.auth import ClientRegistrationOptions, RevocationOptions
from mcp.server.auth.provider import (
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

import crud.oauth as oauth_crud
from database.database import SessionLocal
from logic import token_logic

log = logging.getLogger("zet.oauth")

ROOT_URL = os.getenv("ZET_PUBLIC_URL", "http://localhost:8000").rstrip("/")
AUTH_CODE_TTL = 300                     # 5 min — short-lived, single-use
# Access token lifetime: the issued PAT has no hard server-side expiry, but we advertise
# 30 days so the client refreshes roughly monthly. Combined with the non-expiring refresh
# token, the user logs in once and stays connected (until they log out in the client or
# revoke the token in ZET → Settings → Developer settings).
ACCESS_TTL = 30 * 24 * 60 * 60          # 30 days


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ZetOAuthProvider(OAuthProvider):
    def __init__(self) -> None:
        super().__init__(
            base_url=f"{ROOT_URL}/mcp",
            client_registration_options=ClientRegistrationOptions(enabled=True),
            revocation_options=RevocationOptions(enabled=True),
        )

    # ── Dynamic client registration (DB-backed) ───────────────────────────────
    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        db = SessionLocal()
        try:
            data = oauth_crud.get_client(db, client_id)
        finally:
            db.close()
        if not data:
            return None
        return OAuthClientInformationFull.model_validate_json(data)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if not client_info.client_id:
            return
        db = SessionLocal()
        try:
            oauth_crud.put_client(db, client_info.client_id, client_info.model_dump_json(), _now_iso())
        finally:
            db.close()

    # ── Authorization: hand off to ZET's login/consent page ───────────────────
    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        request_id = secrets.token_urlsafe(24)
        db = SessionLocal()
        try:
            oauth_crud.put_grant(
                db, key=request_id, kind="pending", client_id=client.client_id, user_id="",
                data_json=params.model_dump_json(), expires_at=time.time() + AUTH_CODE_TTL,
            )
        finally:
            db.close()
        return f"{ROOT_URL}/oauth/consent?request_id={request_id}"

    def pending_client_name(self, request_id: str) -> str | None:
        db = SessionLocal()
        try:
            grant = oauth_crud.get_grant(db, request_id, "pending")
            if not grant:
                return None
            data = oauth_crud.get_client(db, grant.client_id)
        finally:
            db.close()
        if data:
            try:
                return OAuthClientInformationFull.model_validate_json(data).client_name or grant.client_id
            except Exception:
                pass
        return grant.client_id

    def complete_authorization(self, request_id: str, user_id: str) -> str:
        """Called by the consent page after the user logs in. Issues the auth code
        and returns the URL to redirect the browser back to the client."""
        db = SessionLocal()
        try:
            grant = oauth_crud.get_grant(db, request_id, "pending")
            if not grant:
                raise ValueError("This authorization request has expired — start again from your client.")
            params = AuthorizationParams.model_validate_json(grant.data)
            client_id = grant.client_id
            oauth_crud.delete_grant(db, request_id)
            code = f"zet_code_{secrets.token_hex(24)}"
            # Only fields present in every SDK version — the user id is carried in the
            # grant row (grant.user_id), not on the AuthorizationCode (older versions
            # have no `subject`/`resource` field).
            ac = AuthorizationCode(
                code=code, client_id=client_id, redirect_uri=params.redirect_uri,
                redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
                scopes=params.scopes or [], expires_at=time.time() + AUTH_CODE_TTL,
                code_challenge=params.code_challenge,
            )
            oauth_crud.put_grant(
                db, key=code, kind="code", client_id=client_id, user_id=user_id,
                data_json=ac.model_dump_json(), expires_at=ac.expires_at,
            )
            return construct_redirect_uri(str(params.redirect_uri), code=code, state=params.state)
        finally:
            db.close()

    async def load_authorization_code(self, client, authorization_code: str):
        db = SessionLocal()
        try:
            grant = oauth_crud.get_grant(db, authorization_code, "code")
        finally:
            db.close()
        if not grant or grant.client_id != client.client_id:
            return None
        return AuthorizationCode.model_validate_json(grant.data)

    # ── Token exchange — issue a PAT as the access token ──────────────────────
    async def exchange_authorization_code(self, client, authorization_code: AuthorizationCode) -> OAuthToken:
        try:
            db = SessionLocal()
            try:
                grant = oauth_crud.get_grant(db, authorization_code.code, "code")
                if not grant:
                    raise TokenError("invalid_grant", "Authorization code not found or already used.")
                oauth_crud.delete_grant(db, authorization_code.code)
                # user id comes from the persisted grant row (works on all SDK versions)
                user_id = grant.user_id or getattr(authorization_code, "subject", None)
                if not user_id:
                    raise TokenError("invalid_grant", "Authorization code is not bound to a user.")
                created = token_logic.create_token(db, user_id, f"MCP OAuth ({client.client_name or client.client_id})")
                refresh = f"zet_refresh_{secrets.token_hex(32)}"
                oauth_crud.put_grant(
                    db, key=refresh, kind="refresh", client_id=client.client_id, user_id=user_id,
                    data_json=json.dumps({"scopes": list(authorization_code.scopes)}), expires_at=None,
                )
            finally:
                db.close()
            # Omit token_type so the SDK's own default applies (its value/casing
            # varies by version — passing the wrong literal raises a ValidationError).
            return OAuthToken(
                access_token=created.token, expires_in=ACCESS_TTL,
                scope=" ".join(authorization_code.scopes) or None, refresh_token=refresh,
            )
        except TokenError:
            raise
        except Exception as e:
            log.exception("OAuth token exchange failed")
            # 'server_error' is NOT a valid OAuth token-error code (the SDK's
            # response model rejects it → secondary 500). Use a valid code and
            # surface the real cause so it's visible in the client.
            raise TokenError("invalid_request", f"Token exchange failed: {e}")

    async def load_refresh_token(self, client, refresh_token: str):
        db = SessionLocal()
        try:
            grant = oauth_crud.get_grant(db, refresh_token, "refresh")
        finally:
            db.close()
        if not grant or grant.client_id != client.client_id:
            return None
        return RefreshToken(token=refresh_token, client_id=client.client_id, scopes=[], expires_at=None)

    async def exchange_refresh_token(self, client, refresh_token: RefreshToken, scopes: list[str]) -> OAuthToken:
        try:
            db = SessionLocal()
            try:
                grant = oauth_crud.get_grant(db, refresh_token.token, "refresh")
                if not grant:
                    raise TokenError("invalid_grant", "Unknown refresh token")
                user_id = grant.user_id
                created = token_logic.create_token(db, user_id, f"MCP OAuth refresh ({client.client_id})")
                oauth_crud.delete_grant(db, refresh_token.token)
                new_refresh = f"zet_refresh_{secrets.token_hex(32)}"
                oauth_crud.put_grant(
                    db, key=new_refresh, kind="refresh", client_id=client.client_id, user_id=user_id,
                    data_json="{}", expires_at=None,
                )
            finally:
                db.close()
            return OAuthToken(
                access_token=created.token, expires_in=ACCESS_TTL,
                scope=None, refresh_token=new_refresh,
            )
        except TokenError:
            raise
        except Exception as e:
            log.exception("OAuth refresh exchange failed")
            raise TokenError("invalid_request", f"Refresh exchange failed: {e}")

    # ── Resource-server validation (also accepts manual PATs) ─────────────────
    async def load_access_token(self, token: str) -> AccessToken | None:
        return await self.verify_token(token)

    async def verify_token(self, token: str) -> AccessToken | None:
        if not token:
            return None
        db = SessionLocal()
        try:
            user_id = token_logic.resolve_user_id(db, token)
        finally:
            db.close()
        if not user_id:
            return None
        return AccessToken(token=token, client_id=user_id, scopes=[])

    async def revoke_token(self, token) -> None:
        raw = getattr(token, "token", None)
        if not raw:
            return
        db = SessionLocal()
        try:
            oauth_crud.delete_grant(db, raw)  # refresh tokens
            token_logic.revoke_raw(db, raw)   # PAT access tokens
        finally:
            db.close()


# Singleton used by both the MCP app (auth) and the consent route.
oauth_provider = ZetOAuthProvider()
