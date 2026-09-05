"""Editing the instructions sent to the model. Superadmin only."""

from fastapi import APIRouter, Depends

from database.database import Db, get_db
from logic import prompt_logic
from logic.schemas import PromptOut, PromptUpdate
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("/ai/prompts", response_model=list[PromptOut])
def list_prompts(user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)):
    return prompt_logic.list_prompts(db, user_id)


@router.put("/ai/prompts/{key}", response_model=PromptOut)
def update_prompt(
    key: str,
    body: PromptUpdate,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return prompt_logic.update_prompt(db, user_id, key, body.body)


@router.delete("/ai/prompts/{key}", response_model=PromptOut)
def reset_prompt(key: str, user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)):
    """Drop the edit so the wording shipped with the app takes over again."""
    return prompt_logic.reset_prompt(db, user_id, key)
