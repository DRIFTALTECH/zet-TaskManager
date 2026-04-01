from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database.database import get_db
from logic import auth_logic
from logic.schemas import LoginBody, LoginResponse, RegisterBody

router = APIRouter()


@router.post("/login", response_model=LoginResponse)
def login(body: LoginBody, db: Session = Depends(get_db)):
    return auth_logic.login(db, body)


@router.post("/register", response_model=LoginResponse)
def register(body: RegisterBody, db: Session = Depends(get_db)):
    return auth_logic.register(db, body)
