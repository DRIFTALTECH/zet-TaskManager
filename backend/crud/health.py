from sqlalchemy import text
from sqlalchemy.orm import Session


def ping(db: Session) -> bool:
    """Cheap liveness query — confirms the DB connection is usable."""
    db.execute(text("SELECT 1"))
    return True
