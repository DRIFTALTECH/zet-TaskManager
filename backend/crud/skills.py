from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import Skill


def list_all(db: Db) -> list[Skill]:
    return rows_to_models(Skill, fetch_all(db, "SELECT * FROM skills ORDER BY LOWER(name)"))


def get_by_id(db: Db, skill_id: str) -> Skill | None:
    return row_to_model(Skill, fetch_one(db, "SELECT * FROM skills WHERE id = %s", (skill_id,)))


def get_by_name_ci(db: Db, name: str) -> Skill | None:
    trimmed = name.strip()
    if not trimmed:
        return None
    return row_to_model(
        Skill,
        fetch_one(db, "SELECT * FROM skills WHERE LOWER(name) = LOWER(%s)", (trimmed,)),
    )


def create(db: Db, *, skill_id: str, name: str, created_at: str) -> Skill:
    trimmed = name.strip()
    db.write(
        "INSERT INTO skills (id, name, created_at) VALUES (%s, %s, %s)",
        (skill_id, trimmed, created_at),
    )
    return row_to_model(
        Skill,
        fetch_one(db, "SELECT * FROM skills WHERE id = %s", (skill_id,)),
    )  # type: ignore[return-value]


def list_skill_names_for_user(db: Db, user_id: str) -> list[str]:
    rows = fetch_all(
        db,
        """
        SELECT s.name FROM skills s
        INNER JOIN user_skills us ON us.skill_id = s.id
        WHERE us.user_id = %s
        ORDER BY LOWER(s.name)
        """,
        (user_id,),
    )
    return [r["name"] for r in rows]


def list_skill_ids_for_user(db: Db, user_id: str) -> list[str]:
    rows = fetch_all(
        db,
        "SELECT skill_id FROM user_skills WHERE user_id = %s",
        (user_id,),
    )
    return [r["skill_id"] for r in rows]


def skill_names_by_user_ids(db: Db, user_ids: list[str]) -> dict[str, list[str]]:
    if not user_ids:
        return {}
    placeholders = ", ".join(["%s"] * len(user_ids))
    rows = fetch_all(
        db,
        f"""
        SELECT us.user_id, s.name FROM user_skills us
        INNER JOIN skills s ON s.id = us.skill_id
        WHERE us.user_id IN ({placeholders})
        ORDER BY LOWER(s.name)
        """,
        tuple(user_ids),
    )
    out: dict[str, list[str]] = {uid: [] for uid in user_ids}
    for r in rows:
        out.setdefault(r["user_id"], []).append(r["name"])
    return out


def skill_names_by_task_ids(db: Db, task_ids: list[str]) -> dict[str, list[str]]:
    if not task_ids:
        return {}
    placeholders = ", ".join(["%s"] * len(task_ids))
    rows = fetch_all(
        db,
        f"""
        SELECT ts.task_id, s.name FROM task_skills ts
        INNER JOIN skills s ON s.id = ts.skill_id
        WHERE ts.task_id IN ({placeholders})
        ORDER BY LOWER(s.name)
        """,
        tuple(task_ids),
    )
    out: dict[str, list[str]] = {tid: [] for tid in task_ids}
    for r in rows:
        out.setdefault(r["task_id"], []).append(r["name"])
    return out


def set_for_user(db: Db, user_id: str, skill_ids: list[str]) -> None:
    import realtime

    wanted = {sid for sid in skill_ids if sid}
    existing_rows = fetch_all(
        db,
        "SELECT skill_id FROM user_skills WHERE user_id = %s",
        (user_id,),
    )
    existing = {r["skill_id"] for r in existing_rows}
    for sid in existing - wanted:
        db.write(
            "DELETE FROM user_skills WHERE user_id = %s AND skill_id = %s",
            (user_id, sid),
        )
    for sid in wanted - existing:
        db.write(
            "INSERT INTO user_skills (user_id, skill_id) VALUES (%s, %s)",
            (user_id, sid),
        )
    realtime.bump("users")
