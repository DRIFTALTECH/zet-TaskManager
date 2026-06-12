from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database.database import get_db
from logic import user_logic
from logic.schemas import PasswordUpdate, ProfileUpdate, UserOut
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("/me", response_model=UserOut)
def me(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    u = user_logic.get_user_or_404(db, user_id)
    return user_logic.to_user_out(db, u)


@router.get("", response_model=list[UserOut])
def list_users(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    user_logic.get_user_or_404(db, user_id)
    return user_logic.list_users(db, viewer_id=user_id)


@router.patch("/me", response_model=UserOut)
def patch_me(
    body: ProfileUpdate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return user_logic.update_profile(db, user_id, body)


@router.post("/me/password")
def change_password(
    body: PasswordUpdate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    user_logic.change_password(db, user_id, body)
    return {"ok": True}
