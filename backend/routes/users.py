from fastapi import APIRouter, Depends, File, UploadFile

from database.database import Db, get_db
from logic import cv_skill_logic, skill_logic, user_logic
from logic.schemas import CvSkillsOut, PasswordUpdate, ProfileUpdate, UserOut, UserSkillsUpdate
from routes.deps import get_current_user_id
from upload_guard import read_limited

router = APIRouter()


@router.get("/me", response_model=UserOut)
def me(user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)):
    u = user_logic.get_user_or_404(db, user_id)
    return user_logic.to_user_out(db, u)


@router.get("", response_model=list[UserOut])
def list_users(user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)):
    user_logic.get_user_or_404(db, user_id)
    return user_logic.list_users(db, viewer_id=user_id)


@router.patch("/me", response_model=UserOut)
def patch_me(
    body: ProfileUpdate,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return user_logic.update_profile(db, user_id, body)


@router.patch("/{target_user_id}/skills", response_model=UserOut)
def set_user_skills(
    target_user_id: str,
    body: UserSkillsUpdate,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    skill_logic.set_user_skills(db, user_id, target_user_id, body)
    u = user_logic.get_user_or_404(db, target_user_id)
    return user_logic.to_user_out(db, u)


@router.post("/me/password")
def change_password(
    body: PasswordUpdate,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    user_logic.change_password(db, user_id, body)
    return {"ok": True}


@router.post("/{target_user_id}/cv-skills", response_model=CvSkillsOut)
async def extract_skills_from_cv(
    target_user_id: str,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    """Parse a CV/resume and return a preview list of extracted skills.
    Nothing is persisted — the client confirms which skills to add.
    Manager/admin only (same guard as skill editing).
    """
    content = await read_limited(file, cv_skill_logic.MAX_FILE_SIZE, label='CV')
    skills = cv_skill_logic.parse_cv_and_extract_skills(
        db, user_id, file.filename, content
    )
    return CvSkillsOut(skills=skills)
