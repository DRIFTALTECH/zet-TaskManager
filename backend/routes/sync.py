import asyncio
import logging

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

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


@router.websocket("/ws")
async def sync_ws(websocket: WebSocket, token: str | None = Query(default=None)):
    """Live update stream. The server pushes `{type:"sync", versions:{...}}` on
    every write; the client refetches only the channel whose version changed.

    Auth is via `?token=` (browsers can't set headers on a WebSocket). The token
    is the same app JWT / PAT used for REST calls.
    """
    if not token:
        await websocket.close(code=4401)
        return

    # Validate the token before accepting the socket.
    db = SessionLocal()
    try:
        auth_logic.resolve_user_id(db, token)
    except Exception:
        await websocket.close(code=4401)
        return
    finally:
        db.close()

    await websocket.accept()
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
