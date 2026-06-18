"""Root-level OAuth discovery metadata for the MCP resource.

The MCP endpoint's 401 challenge points clients to
`/.well-known/oauth-protected-resource/mcp` (RFC 9728). Because the MCP app is
mounted under /mcp, FastMCP doesn't serve that root path itself, so we serve the
protected-resource metadata here and point clients at the authorization-server
metadata that FastMCP serves under the mount."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse, RedirectResponse

from oauth_provider import ROOT_URL

router = APIRouter()

_AS = f"{ROOT_URL}/mcp"  # issuer / authorization server base


def _prm() -> dict:
    return {
        "resource": f"{ROOT_URL}/mcp",
        "authorization_servers": [_AS],
        "bearer_methods_supported": ["header"],
        "scopes_supported": [],
    }


@router.get("/.well-known/oauth-protected-resource/mcp")
@router.get("/.well-known/oauth-protected-resource/mcp/")
def protected_resource_metadata():
    return JSONResponse(_prm())


# Some clients look for the AS metadata at the RFC 8414 path-aware location;
# redirect those to the copy FastMCP serves under the mount.
@router.get("/.well-known/oauth-authorization-server/mcp")
@router.get("/.well-known/oauth-authorization-server/mcp/")
def authorization_server_metadata():
    return RedirectResponse(f"{ROOT_URL}/mcp/.well-known/oauth-authorization-server", status_code=307)
