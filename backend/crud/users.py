from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models

import realtime
from database.models import User


def get_by_email(db: Db, email: str) -> User | None:
    normalized = email.strip().lower()
    row = fetch_one(
        db,
        "SELECT * FROM users WHERE LOWER(email) = %s LIMIT 1",
        (normalized,),
    )
    return row_to_model(User, row)


def get_by_id(db: Db, user_id: str) -> User | None:
    row = fetch_one(db, "SELECT * FROM users WHERE id = %s", (user_id,))
    return row_to_model(User, row)


def list_all(db: Db) -> list[User]:
    rows = fetch_all(db, "SELECT * FROM users ORDER BY name")
    return rows_to_models(User, rows)


def list_visible_to(db: Db, user_id: str) -> list[User]:
    """Directory an employee is allowed to see: themselves, their manager, and
    everyone who shares at least one project with them. Filtered in SQL — never
    fetch-everything-then-filter."""
    rows = fetch_all(
        db,
        """SELECT * FROM users u
           WHERE u.id = %s
              OR u.id = (SELECT manager_id FROM users WHERE id = %s)
              OR u.id IN (
                   SELECT pm.user_id FROM project_members pm
                   WHERE pm.project_id IN (
                       SELECT project_id FROM project_members WHERE user_id = %s
                   )
              )
           ORDER BY u.name""",
        (user_id, user_id, user_id),
    )
    return rows_to_models(User, rows)


def names_for_ids(db: Db, user_ids: list[str]) -> dict[str, str]:
    """Map of user_id → name for the given ids (one query)."""
    if not user_ids:
        return {}
    placeholders = ", ".join(["%s"] * len(user_ids))
    rows = fetch_all(
        db,
        f"SELECT id, name FROM users WHERE id IN ({placeholders})",
        tuple(user_ids),
    )
    return {r["id"]: r["name"] for r in rows}


def update_user(db: Db, user: User, *, name: str | None = None, avatar: str | None = None) -> User:
    sets: list[str] = []
    params: list = []
    if name is not None:
        sets.append("name = %s")
        params.append(name)
    if avatar is not None:
        sets.append("avatar = %s")
        params.append(avatar)
    if sets:
        params.append(user.id)
        db.write(f"UPDATE users SET {', '.join(sets)} WHERE id = %s", tuple(params))
    realtime.bump("users")
    updated = get_by_id(db, user.id)
    assert updated is not None
    return updated


def update_password(db: Db, user: User, password_hash: str) -> User:
    db.write("UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user.id))
    updated = get_by_id(db, user.id)
    assert updated is not None
    return updated


def project_ids_for_user(db: Db, user_id: str) -> list[str]:
    rows = fetch_all(
        db,
        "SELECT project_id FROM project_members WHERE user_id = %s",
        (user_id,),
    )
    return [r["project_id"] for r in rows]


def set_manager_id(db: Db, user: User, manager_id: str | None) -> User:
    db.write("UPDATE users SET manager_id = %s WHERE id = %s", (manager_id, user.id))
    realtime.bump("users")
    updated = get_by_id(db, user.id)
    assert updated is not None
    return updated


def set_role(db: Db, user: User, role: str) -> User:
    db.write("UPDATE users SET role = %s WHERE id = %s", (role, user.id))
    realtime.bump("users")
    updated = get_by_id(db, user.id)
    assert updated is not None
    return updated


def set_active(db: Db, user: User, is_active: bool) -> User:
    db.write("UPDATE users SET is_active = %s WHERE id = %s", (is_active, user.id))
    realtime.bump("users")
    updated = get_by_id(db, user.id)
    assert updated is not None
    return updated


def set_project_membership(db: Db, user_id: str, project_ids: list[str]) -> None:
    """Replace the set of projects this user belongs to with exactly `project_ids`."""
    wanted = {p for p in project_ids if p}
    existing_rows = fetch_all(
        db,
        "SELECT project_id FROM project_members WHERE user_id = %s",
        (user_id,),
    )
    existing = {r["project_id"] for r in existing_rows}
    for pid in existing - wanted:
        db.write(
            "DELETE FROM project_members WHERE user_id = %s AND project_id = %s",
            (user_id, pid),
        )
    for pid in wanted - existing:
        db.write(
            "INSERT INTO project_members (user_id, project_id) VALUES (%s, %s)",
            (user_id, pid),
        )
    realtime.bump("projects", "users")


def create_user(
    db: Db,
    *,
    user_id: str,
    name: str,
    email: str,
    password_hash: str,
    role: str,
    avatar: str = "",
    job_title: str = "",
    experience_months: int = 0,
    joined_at: str = "",
    is_active: bool = True,
) -> User:
    from datetime import datetime, timezone

    joined = joined_at or datetime.now(timezone.utc).isoformat()
    db.write(
        """INSERT INTO users (
               id, name, email, password_hash, role, avatar, job_title, experience_months,
               joined_at, is_active
           ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (user_id, name, email, password_hash, role, avatar, job_title, experience_months,
         joined, is_active),
    )
    realtime.bump("users")
    created = get_by_id(db, user_id)
    assert created is not None
    return created
