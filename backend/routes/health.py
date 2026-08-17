from fastapi import APIRouter, Depends, Response, status

import realtime
import crud.health as health_crud
from database.database import Db, get_db

router = APIRouter()


@router.get("/health")
def health(response: Response, db: Db = Depends(get_db)):
    """App + DB liveness for load balancers / uptime monitors. Unauthenticated.

    Returns 503 when the database is unreachable so a load balancer actually takes
    the instance out of rotation instead of sending traffic to a broken process.
    """
    db_ok = False
    try:
        db_ok = health_crud.ping(db)
    except Exception:
        db_ok = False
    if not db_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ok" if db_ok else "degraded",
        "db": "up" if db_ok else "down",
        "realtime": {"subscribers": realtime.subscriber_count()},
    }
