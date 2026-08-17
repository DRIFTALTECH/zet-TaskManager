from datetime import datetime, timezone

from fastapi import HTTPException, status

import crud.skills as skills_crud
import crud.users as users_crud
from database.database import Db
from database.init_db import new_id
from logic import user_logic
from logic.schemas import SkillCreate, SkillOut, UserSkillsUpdate


def _ensure_manager(db: Db, user_id: str) -> None:
    u = user_logic.get_user_or_404(db, user_id)
    if u.role not in ("manager", "superadmin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Manager only")


def _to_out(skill) -> SkillOut:
    return SkillOut(id=skill.id, name=skill.name, createdAt=skill.created_at)


def list_skills(db: Db, user_id: str) -> list[SkillOut]:
    _ensure_manager(db, user_id)
    return [_to_out(s) for s in skills_crud.list_all(db)]


def get_or_create_skill(db: Db, user_id: str, body: SkillCreate) -> SkillOut:
    _ensure_manager(db, user_id)
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Skill name is required")
    existing = skills_crud.get_by_name_ci(db, name)
    if existing:
        return _to_out(existing)
    created = skills_crud.create(
        db,
        skill_id=new_id("sk"),
        name=name,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    return _to_out(created)


def set_user_skills(db: Db, manager_id: str, target_user_id: str, body: UserSkillsUpdate) -> list[str]:
    _ensure_manager(db, manager_id)
    user_logic.get_user_or_404(db, target_user_id)
    skill_ids = list(dict.fromkeys(body.skillIds))
    for sid in skill_ids:
        if not skills_crud.get_by_id(db, sid):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Skill not found")
    skills_crud.set_for_user(db, target_user_id, skill_ids)
    return skills_crud.list_skill_names_for_user(db, target_user_id)
