from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.orm import Session

from database.database import get_db
from logic import meeting_notes_logic
from logic.schemas import ScrumCreate, ScrumDaySummary, ScrumOut, ScrumUpdate
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[ScrumDaySummary])
def list_days(
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str = Query(..., description="YYYY-MM-DD"),
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return meeting_notes_logic.list_range(db, start, end)


@router.get("/day/{work_date}", response_model=list[ScrumOut])
def list_day(work_date: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return meeting_notes_logic.list_for_date(db, work_date)


@router.post("/day/{work_date}", response_model=ScrumOut)
def create_scrum(work_date: str, body: ScrumCreate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return meeting_notes_logic.create_scrum(db, work_date, body, user_id)


@router.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Transcribe a dropped meeting recording to text (for review before saving).
    Returns {text}."""
    audio = await file.read()
    return {"text": meeting_notes_logic.transcribe_audio(audio, file.filename)}


@router.put("/scrum/{scrum_id}", response_model=ScrumOut)
def update_scrum(scrum_id: str, body: ScrumUpdate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return meeting_notes_logic.update_scrum(db, scrum_id, body, user_id)


@router.post("/scrum/{scrum_id}/reparse", response_model=ScrumOut)
def reparse_scrum(scrum_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return meeting_notes_logic.reparse_scrum(db, scrum_id, user_id)


@router.delete("/scrum/{scrum_id}")
def delete_scrum(scrum_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    meeting_notes_logic.delete_scrum(db, scrum_id, user_id)
    return {"ok": True}
