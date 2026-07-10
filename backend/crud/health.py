from crud._base import Db


def ping(db: Db) -> bool:
    """Cheap liveness query — confirms the DB connection is usable."""
    db.read("SELECT 1 AS ok")
    return True
