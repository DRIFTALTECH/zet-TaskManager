"""CRUD for the Teams transcript import ledger (dedup so a sync runs idempotently)."""

from database.models import TeamsTranscriptImport

from crud._base import Db, fetch_one

_SELECT = """SELECT transcript_id, meeting_id, scrum_id, imported_by, imported_at
    FROM teams_transcript_imports"""


def is_imported(db: Db, transcript_id: str) -> bool:
    return fetch_one(db, f"{_SELECT} WHERE transcript_id = %s", (transcript_id,)) is not None


def record(
    db: Db,
    *,
    transcript_id: str,
    meeting_id: str,
    scrum_id: str | None,
    imported_by: str | None,
    imported_at: str,
) -> TeamsTranscriptImport:
    db.write(
        """INSERT INTO teams_transcript_imports
            (transcript_id, meeting_id, scrum_id, imported_by, imported_at)
            VALUES (%s, %s, %s, %s, %s)""",
        (transcript_id, meeting_id, scrum_id, imported_by, imported_at),
    )
    row = TeamsTranscriptImport(
        transcript_id=transcript_id,
        meeting_id=meeting_id,
        scrum_id=scrum_id,
        imported_by=imported_by,
        imported_at=imported_at,
    )
    return row
