from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import realtime
import crud.health as health_crud
from database.database import get_db

router = APIRouter()


@router.get("/health")
def health(db: Session = Depends(get_db)):
    """App + DB liveness for load balancers / uptime monitors. Unauthenticated."""
    db_ok = False
    try:
        db_ok = health_crud.ping(db)
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "db": "up" if db_ok else "down",
        "realtime": {"subscribers": realtime.subscriber_count()},
    }
