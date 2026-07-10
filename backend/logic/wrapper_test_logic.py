"""Temporary verification logic for the database wrapper (remove after migration)."""
from __future__ import annotations

from db_wrapper import get_database

_DEMO_TABLE = "zet_wrapper_demo"
_ENSURE_DEMO_TABLE = f"""
CREATE TABLE IF NOT EXISTS {_DEMO_TABLE} (
    id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
)
"""


def wrapper_test_read() -> dict:
    db = get_database()
    rows = db.read(
        "SELECT version() AS version, current_user AS db_user, now() AS server_time"
    )
    return {"ok": True, "rows": rows}


def wrapper_test_write(message: str = "wrapper test write") -> dict:
    db = get_database()
    db.write(_ENSURE_DEMO_TABLE)
    write_result = db.write(
        f"INSERT INTO {_DEMO_TABLE} (message) VALUES (%s)",
        (message,),
    )
    inserted = db.read(
        f"SELECT id, message, created_at FROM {_DEMO_TABLE} ORDER BY id DESC LIMIT 1"
    )
    return {"ok": True, "write": write_result, "inserted": inserted}

   
"""

def create_test_table():
    db = get_database()

    return db.write(
        CREATE TABLE test (
            id SERIAL PRIMARY KEY,
            message VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    )

def insert_test():
    db = get_database()

    db.write(
        "INSERT INTO test(message) VALUES (%s)",
        ("Wrapper works!",)
    )

    return db.read(
        "SELECT * FROM test ORDER BY id DESC LIMIT 1"
    )
def get_all():
    db = get_database()

    return db.read(
        "SELECT * FROM test ORDER BY id"
    )
    """