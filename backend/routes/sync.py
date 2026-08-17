import asyncio
import json
import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

import realtime
from database.database import SessionLocal
from logic import auth_logic
from routes.deps import get_current_user_id

router = APIRouter()
log = logging.getLogger("zet.sync")


@router.get("/version")
def sync_version(user_id: str = Depends(get_current_user_id)):
    """Per-channel change versions — polling fallback for the WebSocket feed.

    Clients that can hold a socket open use `/sync/ws`; this endpoint stays for
    environments where WebSockets are blocked (some proxies/corporate networks).
    """
    return realtime.snapshot()


# How long the client has to send its auth frame before we drop the socket.
_AUTH_TIMEOUT_SECONDS = 10


@router.websocket("/ws")
async def sync_ws(websocket: WebSocket):
    """Live update stream. The server pushes `{type:"sync", versions:{...}}` on
    every write; the client refetches only the channel whose version changed.

    Auth is the FIRST message frame: `{"type":"auth","token":"<jwt-or-pat>"}`.
    It deliberately is not a `?token=` query parameter — a URL carries the
    credential into every proxy and load-balancer access log along the path.
    """
    await websocket.accept()

    # Read the auth frame. A client that sends nothing gets dropped rather than
    # holding an unauthenticated socket open.
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=_AUTH_TIMEOUT_SECONDS)
        hello = json.loads(raw)
        token = hello.get("token") if hello.get("type") == "auth" else None
    except (TimeoutError, asyncio.TimeoutError, json.JSONDecodeError, WebSocketDisconnect, AttributeError):
        await websocket.close(code=4401)
        return

    if not token:
        await websocket.close(code=4401)
        return

    db = SessionLocal()
    try:
        auth_logic.resolve_user_id(db, token)
    except Exception:
        await websocket.close(code=4401)
        return
    finally:
        db.close()
    realtime.set_loop(asyncio.get_running_loop())
    realtime.add_subscriber(websocket)
    try:
        # Send the current snapshot immediately so the client has a baseline.
        await websocket.send_json({"type": "sync", "versions": realtime.snapshot()})
        # Hold the connection open. Inbound messages (client pings) are ignored;
        # receiving is how we detect a clean disconnect.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        log.debug("sync ws closed with error", exc_info=True)
    finally:
        realtime.remove_subscriber(websocket)
