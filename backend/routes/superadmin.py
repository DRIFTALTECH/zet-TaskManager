"""Superadmin console routes — mounted at /superadmin.

The superadmin is a normal user row with role="superadmin" who signs in through
/auth/login like anyone else; there is no separate console login. Every route
below re-checks the role on each request via require_superadmin, which also
yields the acting superadmin's id for the audit trail.
"""

from fastapi import APIRouter, Depends

from database.database import Db, get_db
from logic import superadmin_logic
from logic.audit import get_audit_logs
from logic.schemas import (
    AuditLogOut,
    SuperadminManagerUpdate,
    SuperadminPasswordReset,
    SuperadminProjectOut,
    SuperadminProjectsUpdate,
    SuperadminRoleUpdate,
    SuperadminUserDelete,
    UserOut,
)
from routes.deps import require_superadmin

router = APIRouter()


@router.get("/users", response_model=list[UserOut])
def list_users(actor_id: str = Depends(require_superadmin), db: Db = Depends(get_db)):
    return superadmin_logic.list_users(db)


@router.get("/users/pending", response_model=list[UserOut])
def list_pending_users(actor_id: str = Depends(require_superadmin), db: Db = Depends(get_db)):
    """Accounts awaiting approval — the superadmin's inbox."""
    return superadmin_logic.list_pending(db)


@router.get("/projects", response_model=list[SuperadminProjectOut])
def list_projects(actor_id: str = Depends(require_superadmin), db: Db = Depends(get_db)):
    return superadmin_logic.list_projects(db)


@router.patch("/users/{user_id}/role", response_model=UserOut)
def change_role(
    user_id: str,
    body: SuperadminRoleUpdate,
    actor_id: str = Depends(require_superadmin),
    db: Db = Depends(get_db),
):
    return superadmin_logic.change_role(db, actor_id, user_id, body)


@router.post("/users/{user_id}/activate", response_model=UserOut)
def activate(user_id: str, actor_id: str = Depends(require_superadmin), db: Db = Depends(get_db)):
    return superadmin_logic.set_active(db, actor_id, user_id, True)


@router.post("/users/{user_id}/deactivate", response_model=UserOut)
def deactivate(user_id: str, actor_id: str = Depends(require_superadmin), db: Db = Depends(get_db)):
    return superadmin_logic.set_active(db, actor_id, user_id, False)


@router.post("/users/{user_id}/password")
def reset_password(
    user_id: str,
    body: SuperadminPasswordReset,
    actor_id: str = Depends(require_superadmin),
    db: Db = Depends(get_db),
):
    superadmin_logic.reset_password(db, actor_id, user_id, body.new_password)
    return {"ok": True}


@router.put("/users/{user_id}/projects", response_model=UserOut)
def set_projects(
    user_id: str,
    body: SuperadminProjectsUpdate,
    actor_id: str = Depends(require_superadmin),
    db: Db = Depends(get_db),
):
    return superadmin_logic.set_projects(db, actor_id, user_id, body)


@router.patch("/users/{user_id}/manager", response_model=UserOut)
def set_manager(
    user_id: str,
    body: SuperadminManagerUpdate,
    actor_id: str = Depends(require_superadmin),
    db: Db = Depends(get_db),
):
    return superadmin_logic.set_manager(db, actor_id, user_id, body)


@router.post("/users/{user_id}/delete")
def delete_user(
    user_id: str,
    body: SuperadminUserDelete,
    actor_id: str = Depends(require_superadmin),
    db: Db = Depends(get_db),
):
    superadmin_logic.delete_user(db, actor_id, user_id, body.reassign_to)
    return {"ok": True}


@router.get("/audit", response_model=list[AuditLogOut])
def list_audit(limit: int = 200, actor_id: str = Depends(require_superadmin), db: Db = Depends(get_db)):
    return get_audit_logs(db, actor_id, is_manager=True, limit=limit)
