from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import Client


def list_all(db: Db) -> list[Client]:
    return rows_to_models(Client, fetch_all(db, "SELECT * FROM clients ORDER BY LOWER(name)"))


def get_by_id(db: Db, client_id: str) -> Client | None:
    return row_to_model(Client, fetch_one(db, "SELECT * FROM clients WHERE id = %s", (client_id,)))


def names_by_ids(db: Db, client_ids: list[str]) -> dict[str, str]:
    ids = [c for c in client_ids if c]
    if not ids:
        return {}
    rows = fetch_all(db, "SELECT id, name FROM clients WHERE id = ANY(%s)", (ids,))
    return {r["id"]: r["name"] for r in rows}


def get_by_name_ci(db: Db, name: str) -> Client | None:
    trimmed = name.strip()
    if not trimmed:
        return None
    return row_to_model(
        Client,
        fetch_one(db, "SELECT * FROM clients WHERE LOWER(name) = LOWER(%s)", (trimmed,)),
    )


def create(db: Db, *, client_id: str, name: str, created_at: str) -> Client:
    trimmed = name.strip()
    db.write(
        "INSERT INTO clients (id, name, created_at) VALUES (%s, %s, %s)",
        (client_id, trimmed, created_at),
    )
    return row_to_model(
        Client,
        fetch_one(db, "SELECT * FROM clients WHERE id = %s", (client_id,)),
    )  # type: ignore[return-value]
