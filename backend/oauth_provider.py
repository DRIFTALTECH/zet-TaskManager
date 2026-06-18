"""
ZET OAuth 2.1 Authorization Server for MCP.

Lets an MCP client connect with just the MCP URL: the client self-registers
(Dynamic Client Registration), opens ZET's login/consent page in the browser,
the user logs into ZET, and the client receives a token — no copy-pasting.

Issued access tokens are ZET personal access tokens (PATs), so the resource
side (`verify_token`) reuses the same validation, and tokens are revocable.
Clients, auth codes and refresh tokens are kept in-process (short-lived / re-
registrable); a server restart simply makes clients re-auth on next use.
"""

import os
import secrets
import time

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

from database.database import SessionLocal
from logic import token_logic

ROOT_URL = os.getenv("ZET_PUBLIC_URL", "http://localhost:8000").rstrip("/")
AUTH_CODE_TTL = 300        # 5 min
ACCESS_TTL = 60 * 60       # advertised access-token lifetime (client refreshes after)


class ZetOAuthProvider(OAuthProvider):
    def __init__(self) -> None:
        super().__init__(
            base_url=f"{ROOT_URL}/mcp",
            client_registration_options=ClientRegistrationOptions(enabled=True),
            revocation_options=RevocationOptions(enabled=True),
        )
        self.clients: dict[str, OAuthClientInformationFull] = {}
        self.auth_codes: dict[str, AuthorizationCode] = {}
        self.pending: dict[str, tuple[str, AuthorizationParams]] = {}  # request_id -> (client_id, params)
        self.refresh: dict[str, dict] = {}  # refresh_token -> {user_id, client_id, scopes}

    # ── Dynamic client registration ───────────────────────────────────────────
    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        return self.clients.get(client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if client_info.client_id:
            self.clients[client_info.client_id] = client_info

    # ── Authorization: hand off to ZET's login/consent page ───────────────────
    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        request_id = secrets.token_urlsafe(24)
        self.pending[request_id] = (client.client_id, params)
        return f"{ROOT_URL}/oauth/consent?request_id={request_id}"

    def pending_client_name(self, request_id: str) -> str | None:
        item = self.pending.get(request_id)
        if not item:
            return None
        client = self.clients.get(item[0])
        return getattr(client, "client_name", None) or item[0]

    def complete_authorization(self, request_id: str, user_id: str) -> str:
        """Called by the consent page after the user logs in. Issues the auth code
        and returns the URL to redirect the browser back to the client."""
        item = self.pending.pop(request_id, None)
        if not item:
            raise ValueError("This authorization request has expired — start again from your client.")
        client_id, params = item
        code = f"zet_code_{secrets.token_hex(24)}"
        self.auth_codes[code] = AuthorizationCode(
            code=code,
            client_id=client_id,
            redirect_uri=params.redirect_uri,
            redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            scopes=params.scopes or [],
            expires_at=time.time() + AUTH_CODE_TTL,
            code_challenge=params.code_challenge,
            resource=params.resource,
            subject=user_id,
        )
        return construct_redirect_uri(str(params.redirect_uri), code=code, state=params.state)

    async def load_authorization_code(self, client, authorization_code: str):
        ac = self.auth_codes.get(authorization_code)
        if not ac or ac.client_id != client.client_id:
            return None
        if ac.expires_at < time.time():
            self.auth_codes.pop(authorization_code, None)
            return None
        return ac

    # ── Token exchange — issue a PAT as the access token ──────────────────────
    async def exchange_authorization_code(self, client, authorization_code: AuthorizationCode) -> OAuthToken:
        if authorization_code.code not in self.auth_codes:
            raise TokenError("invalid_grant", "Authorization code not found or already used.")
        self.auth_codes.pop(authorization_code.code, None)
        user_id = authorization_code.subject
        db = SessionLocal()
        try:
            created = token_logic.create_token(db, user_id, f"MCP OAuth ({client.client_name or client.client_id})")
        finally:
            db.close()
        refresh = f"zet_refresh_{secrets.token_hex(32)}"
        self.refresh[refresh] = {"user_id": user_id, "client_id": client.client_id, "scopes": authorization_code.scopes}
        return OAuthToken(
            access_token=created.token, token_type="Bearer", expires_in=ACCESS_TTL,
            scope=" ".join(authorization_code.scopes) or None, refresh_token=refresh,
        )

    async def load_refresh_token(self, client, refresh_token: str):
        d = self.refresh.get(refresh_token)
        if not d or d["client_id"] != client.client_id:
            return None
        return RefreshToken(token=refresh_token, client_id=client.client_id, scopes=d["scopes"], expires_at=None)

    async def exchange_refresh_token(self, client, refresh_token: RefreshToken, scopes: list[str]) -> OAuthToken:
        d = self.refresh.get(refresh_token.token)
        if not d:
            raise TokenError("invalid_grant", "Unknown refresh token")
        db = SessionLocal()
        try:
            created = token_logic.create_token(db, d["user_id"], f"MCP OAuth refresh ({client.client_id})")
        finally:
            db.close()
        self.refresh.pop(refresh_token.token, None)
        new_refresh = f"zet_refresh_{secrets.token_hex(32)}"
        self.refresh[new_refresh] = d
        return OAuthToken(
            access_token=created.token, token_type="Bearer", expires_in=ACCESS_TTL,
            scope=" ".join(d["scopes"]) or None, refresh_token=new_refresh,
        )

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
        # client_id carries the ZET user id (the MCP tools read it via _uid()).
        return AccessToken(token=token, client_id=user_id, scopes=[])

    async def revoke_token(self, token) -> None:
        raw = getattr(token, "token", None)
        if raw and raw in self.refresh:
            self.refresh.pop(raw, None)
        if raw:
            db = SessionLocal()
            try:
                token_logic.revoke_raw(db, raw)
            finally:
                db.close()


# Singleton used by both the MCP app (auth) and the consent route.
oauth_provider = ZetOAuthProvider()
