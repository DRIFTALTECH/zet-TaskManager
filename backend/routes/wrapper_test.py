"""Temporary wrapper verification endpoints (remove after migration)."""
from fastapi import APIRouter
from pydantic import BaseModel, Field

from logic import wrapper_test_logic

router = APIRouter()


@router.get("/wrapper/test-read")
def wrapper_test_read():
    """Execute a simple SELECT via the database wrapper."""
    return wrapper_test_logic.wrapper_test_read()


class WrapperTestWriteBody(BaseModel):
    message: str = Field(default="wrapper test write", max_length=500)


@router.post("/wrapper/test-write")
def wrapper_test_write(body: WrapperTestWriteBody | None = None):
    """Insert a demo row via the database wrapper."""
    msg = body.message if body else "wrapper test write"
    return wrapper_test_logic.wrapper_test_write(msg)
