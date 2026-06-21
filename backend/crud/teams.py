"""CRUD for the Teams transcript import ledger (dedup so a sync runs idempotently)."""

from sqlalchemy.orm import Session

from database.models import TeamsTranscriptImport


def is_imported(db: Session, transcript_id: str) -> bool:
    return db.get(TeamsTranscriptImport, transcript_id) is not None


def record(
    db: Session,
    *,
    transcript_id: str,
    meeting_id: str,
    scrum_id: str | None,
    imported_by: str | None,
    imported_at: str,
) -> TeamsTranscriptImport:
    row = TeamsTranscriptImport(
        transcript_id=transcript_id,
        meeting_id=meeting_id,
        scrum_id=scrum_id,
        imported_by=imported_by,
        imported_at=imported_at,
    )
    db.add(row)
    db.flush()
    return row
