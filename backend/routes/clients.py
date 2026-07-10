from fastapi import APIRouter, Depends

from database.database import Db, get_db
from logic import client_logic
from logic.schemas import ClientCreate, ClientOut
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[ClientOut])
def list_clients(user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)):
    return client_logic.list_clients(db, user_id)


@router.post("", response_model=ClientOut)
def create_client(
    body: ClientCreate,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return client_logic.get_or_create_client(db, user_id, body)
