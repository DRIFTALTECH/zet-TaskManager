"""Teams → MOM endpoints. Thin: parse input, call one logic function, return."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database.database import get_db
from logic import teams_logic
from logic.schemas import TeamsImportBody, TeamsImportResult, TeamsStatusOut, TeamsSyncBody
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("/status", response_model=TeamsStatusOut)
def status(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return teams_logic.status_out(db, user_id)


@router.post("/import", response_model=TeamsImportResult)
def import_meeting(
    body: TeamsImportBody,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return teams_logic.import_meeting(
        db, user_id,
        organizer_email=body.organizerEmail, join_url=body.joinUrl,
        date=body.date, title=body.title,
    )


@router.post("/sync", response_model=TeamsImportResult)
def sync(
    body: TeamsSyncBody,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return teams_logic.sync_transcripts(
        db, user_id, organizer_email=body.organizerEmail, since=body.since,
    )
