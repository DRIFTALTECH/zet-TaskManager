from datetime import datetime, timezone

from fastapi import HTTPException, status

from database.database import Db
from database.init_db import new_id
import crud.clients as clients_crud
from logic import user_logic
from logic.schemas import ClientCreate, ClientOut


def _ensure_manager(db: Db, user_id: str) -> None:
    u = user_logic.get_user_or_404(db, user_id)
    if u.role not in ("manager", "superadmin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Manager only")


def _to_out(c) -> ClientOut:
    return ClientOut(id=c.id, name=c.name, createdAt=c.created_at)


def list_clients(db: Db, user_id: str) -> list[ClientOut]:
    _ensure_manager(db, user_id)
    return [_to_out(c) for c in clients_crud.list_all(db)]


def get_or_create_client(db: Db, user_id: str, body: ClientCreate) -> ClientOut:
    """Return existing client when name matches case-insensitively; otherwise create."""
    _ensure_manager(db, user_id)
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Client name is required")
    existing = clients_crud.get_by_name_ci(db, name)
    if existing:
        return _to_out(existing)
    created = clients_crud.create(
        db,
        client_id=new_id("c"),
        name=name,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    return _to_out(created)


def ensure_client_id(db: Db, client_id: str) -> None:
    if not clients_crud.get_by_id(db, client_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Client not found")
