"""Microsoft Graph app-only client — read Teams online-meeting transcripts.

Pure external I/O: acquires an app-only (client-credentials) token via MSAL and
makes Graph REST calls with httpx. No DB, no business rules — `logic/teams_logic.py`
orchestrates and persists. Network/permission failures raise GraphError, which the
logic layer maps to user-facing HTTP errors.

Graph requirements (configured in Azure, see logic/teams_logic for the checklist):
  - Application permission OnlineMeetingTranscript.Read.All (admin-consented)
  - A Teams application-access-policy granting this app access to the organizer's
    meetings (Set-CsApplicationAccessPolicy / Grant-CsApplicationAccessPolicy)
"""

import logging
import ssl
import threading

import certifi
import httpx
import msal

import config

log = logging.getLogger("zet.msgraph")

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_BETA = "https://graph.microsoft.com/beta"
_SCOPE = ["https://graph.microsoft.com/.default"]

# Reuse one TLS context + MSAL app + token cache across calls (thread-safe).
_lock = threading.Lock()
_ssl_ctx = ssl.create_default_context(cafile=certifi.where())
_msal_app: msal.ConfidentialClientApplication | None = None


class GraphError(RuntimeError):
    """A Graph call failed (auth, permission, not-found, or transport)."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def is_configured() -> bool:
    return config.graph_configured()


def _app() -> msal.ConfidentialClientApplication:
    global _msal_app
    with _lock:
        if _msal_app is None:
            _msal_app = msal.ConfidentialClientApplication(
                client_id=config.MICROSOFT_CLIENT_ID,
                client_credential=config.MICROSOFT_CLIENT_SECRET,
                authority=f"https://login.microsoftonline.com/{config.MICROSOFT_TENANT_ID}",
            )
        return _msal_app


def _token() -> str:
    if not is_configured():
        raise GraphError(
            "Microsoft Graph is not configured. Set MICROSOFT_TENANT_ID, "
            "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET on the backend.",
            status_code=503,
        )
    # MSAL caches and silently refreshes the app token internally.
    result = _app().acquire_token_for_client(scopes=_SCOPE)
    if "access_token" not in result:
        err = result.get("error_description") or result.get("error") or "unknown error"
        raise GraphError(f"Could not acquire Microsoft Graph token: {err}", status_code=502)
    return result["access_token"]


def _client(accept: str = "application/json") -> httpx.Client:
    return httpx.Client(
        verify=_ssl_ctx,
        timeout=30.0,
        headers={"Authorization": f"Bearer {_token()}", "Accept": accept},
    )


def _get_json(url: str, params: dict | None = None) -> dict:
    with _client() as c:
        r = c.get(url, params=params)
    if r.status_code >= 400:
        raise GraphError(_explain(r), status_code=r.status_code)
    return r.json()


def _explain(r: httpx.Response) -> str:
    """Turn a Graph error body into a short, actionable message."""
    try:
        err = r.json().get("error", {})
        code = err.get("code", "")
        msg = err.get("message", "")
    except Exception:
        code, msg = "", r.text[:200]
    if r.status_code == 403:
        return (f"Graph access denied ({code}). Confirm OnlineMeetingTranscript.Read.All "
                f"is admin-consented and a Teams application-access-policy grants this app "
                f"access to the organizer. {msg}")
    if r.status_code == 404:
        return f"Not found in Graph ({code}). {msg}"
    return f"Graph error {r.status_code} ({code}). {msg}"


# ── User / meeting lookup ───────────────────────────────────────────────────────

def get_user(email_or_id: str) -> dict:
    """Resolve a directory user (the meeting organizer) by email/UPN or object id."""
    return _get_json(f"{GRAPH_BASE}/users/{email_or_id}")


def find_meeting_by_join_url(organizer_id: str, join_url: str) -> dict:
    """Find the organizer's online meeting matching a Teams join link."""
    # Escape single quotes per OData (double them) so the join URL can't break or
    # inject the filter. httpx URL-encodes the param value when sending.
    safe = join_url.replace("'", "''")
    data = _get_json(
        f"{GRAPH_BASE}/users/{organizer_id}/onlineMeetings",
        params={"$filter": f"JoinWebUrl eq '{safe}'"},
    )
    items = data.get("value", []) or []
    if not items:
        raise GraphError(
            "No Teams meeting found for that join link under this organizer. "
            "Check the link and that the organizer email is the meeting owner.",
            status_code=404,
        )
    return items[0]


def list_meeting_transcripts(organizer_id: str, meeting_id: str) -> list[dict]:
    data = _get_json(f"{GRAPH_BASE}/users/{organizer_id}/onlineMeetings/{meeting_id}/transcripts")
    return data.get("value", []) or []


def list_all_transcripts(organizer_id: str) -> list[dict]:
    """All transcripts across the organizer's meetings (beta getAllTranscripts) —
    used by the polling sync. Each item carries id, meetingId, createdDateTime.

    getAllTranscripts is an OData *function* that REQUIRES meetingOrganizerUserId
    as a bound parameter (a bare path 400s). We pass no $top — with it, Graph may
    omit @odata.nextLink (documented issue) and silently truncate paging."""
    out: list[dict] = []
    url = (
        f"{GRAPH_BETA}/users/{organizer_id}/onlineMeetings/"
        f"getAllTranscripts(meetingOrganizerUserId='{organizer_id}')"
    )
    while url:
        data = _get_json(url)
        out.extend(data.get("value", []) or [])
        url = data.get("@odata.nextLink")
    return out


def transcript_content_vtt(organizer_id: str, meeting_id: str, transcript_id: str) -> str:
    """Download a transcript as WebVTT text."""
    url = f"{GRAPH_BASE}/users/{organizer_id}/onlineMeetings/{meeting_id}/transcripts/{transcript_id}/content"
    with _client(accept="text/vtt") as c:
        r = c.get(url, params={"$format": "text/vtt"})
    if r.status_code >= 400:
        raise GraphError(_explain(r), status_code=r.status_code)
    return r.text
