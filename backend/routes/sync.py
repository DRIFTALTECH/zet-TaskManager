from fastapi import APIRouter, Depends

import realtime
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("/version")
def sync_version(user_id: str = Depends(get_current_user_id)):
    """Per-channel change versions for smart polling.

    Clients poll this single tiny endpoint and refetch only the channel
    ("tasks", "projects", "users") whose number changed.
    """
    return realtime.snapshot()
