from fastapi import APIRouter, Depends

from database.database import Db, get_db
from logic import skill_logic
from logic.schemas import SkillCreate, SkillOut
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[SkillOut])
def list_skills(user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)):
    return skill_logic.list_skills(db, user_id)


@router.post("", response_model=SkillOut)
def create_skill(
    body: SkillCreate,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return skill_logic.get_or_create_skill(db, user_id, body)
