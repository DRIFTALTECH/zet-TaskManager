from fastapi import APIRouter, Depends
from database.database import Db

from database.database import get_db
from logic import auth_logic
from logic.schemas import LoginBody, LoginResponse, MicrosoftAuthBody, RegisterBody

router = APIRouter()


@router.post("/login", response_model=LoginResponse)
def login(body: LoginBody, db: Db = Depends(get_db)):
    return auth_logic.login(db, body)


@router.post("/register", response_model=LoginResponse)
def register(body: RegisterBody, db: Db = Depends(get_db)):
    return auth_logic.register(db, body)


@router.post("/microsoft", response_model=LoginResponse)
def microsoft_auth(body: MicrosoftAuthBody, db: Db = Depends(get_db)):
    return auth_logic.microsoft_auth(db, body)
