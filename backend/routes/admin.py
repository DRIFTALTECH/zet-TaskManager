"""Admin console routes — mounted at /admin.

A standalone admin (env-configured `admin` / `Default@123`, password changeable
at runtime) manages user accounts. `/admin/login` is public; everything else
requires an admin-scoped token via the require_admin dependency.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database.database import get_db
from logic import admin_logic, auth_logic
from logic.audit import get_audit_logs
from logic.schemas import (
    AdminChangePassword,
    AdminLoginBody,
    AdminPasswordReset,
    AdminProjectOut,
    AdminProjectsUpdate,
    AdminRoleUpdate,
    AdminTokenResponse,
    AdminUserDelete,
    AuditLogOut,
    UserOut,
)
from routes.deps import require_admin

router = APIRouter()


@router.post("/login", response_model=AdminTokenResponse)
def admin_login(body: AdminLoginBody, db: Session = Depends(get_db)):
    token = auth_logic.admin_login(db, body.username, body.password)
    return AdminTokenResponse(access_token=token)


@router.get("/users", response_model=list[UserOut], dependencies=[Depends(require_admin)])
def list_users(db: Session = Depends(get_db)):
    return admin_logic.list_users(db)


@router.get("/projects", response_model=list[AdminProjectOut], dependencies=[Depends(require_admin)])
def list_projects(db: Session = Depends(get_db)):
    return admin_logic.list_projects(db)


@router.patch("/users/{user_id}/role", response_model=UserOut, dependencies=[Depends(require_admin)])
def change_role(user_id: str, body: AdminRoleUpdate, db: Session = Depends(get_db)):
    return admin_logic.change_role(db, user_id, body)


@router.post("/users/{user_id}/password", dependencies=[Depends(require_admin)])
def reset_password(user_id: str, body: AdminPasswordReset, db: Session = Depends(get_db)):
    admin_logic.reset_password(db, user_id, body.new_password)
    return {"ok": True}


@router.put("/users/{user_id}/projects", response_model=UserOut, dependencies=[Depends(require_admin)])
def set_projects(user_id: str, body: AdminProjectsUpdate, db: Session = Depends(get_db)):
    return admin_logic.set_projects(db, user_id, body)


@router.post("/users/{user_id}/deactivate", response_model=UserOut, dependencies=[Depends(require_admin)])
def deactivate(user_id: str, db: Session = Depends(get_db)):
    return admin_logic.set_active(db, user_id, False)


@router.post("/users/{user_id}/activate", response_model=UserOut, dependencies=[Depends(require_admin)])
def activate(user_id: str, db: Session = Depends(get_db)):
    return admin_logic.set_active(db, user_id, True)


@router.post("/users/{user_id}/delete", dependencies=[Depends(require_admin)])
def delete_user(user_id: str, body: AdminUserDelete, db: Session = Depends(get_db)):
    admin_logic.delete_user(db, user_id, body.reassign_to)
    return {"ok": True}


@router.get("/audit", response_model=list[AuditLogOut], dependencies=[Depends(require_admin)])
def list_audit(limit: int = 200, db: Session = Depends(get_db)):
    return get_audit_logs(db, auth_logic.ADMIN_SUBJECT, is_manager=True, limit=limit)


@router.post("/password", dependencies=[Depends(require_admin)])
def change_admin_password(body: AdminChangePassword, db: Session = Depends(get_db)):
    admin_logic.change_admin_password(db, body.current_password, body.new_password)
    return {"ok": True}
