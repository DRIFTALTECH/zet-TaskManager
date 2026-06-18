"""Personal access tokens for programmatic / MCP access: /auth/tokens"""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from database.database import get_db
from logic import token_logic
from logic.schemas import (
    PersonalAccessTokenCreate,
    PersonalAccessTokenCreated,
    PersonalAccessTokenOut,
)
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[PersonalAccessTokenOut])
def list_tokens(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return token_logic.list_tokens(db, user_id)


@router.post("", response_model=PersonalAccessTokenCreated)
def create_token(
    body: PersonalAccessTokenCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return token_logic.create_token(db, user_id, body.name)


@router.delete("/{token_id}", status_code=204)
def revoke_token(
    token_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    token_logic.revoke_token(db, user_id, token_id)
    return Response(status_code=204)
