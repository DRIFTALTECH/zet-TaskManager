"""Teams → MOM: pull Microsoft Teams meeting transcripts and turn them into scrums.

Two entry points, both manager/admin-only (same gate as creating tasks from text):
  * import_meeting  — one meeting by its Teams join link (on-demand button)
  * sync_transcripts — every not-yet-imported transcript for an organizer (the
    automation; cron this endpoint or call it from a scheduled job)

Each transcript is downloaded as WebVTT, flattened to readable "Speaker: line"
text, then handed to the SAME internal LLM the manual MOM flow uses
(meeting_notes_logic.create_scrum → chains.parse_meeting_notes) so the per-person
breakdown is produced identically. A dedup ledger (crud/teams) keeps sync idempotent.

External Graph I/O lives in integrations/msgraph; DB writes go through crud only.
"""

import logging
import re
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import config
import crud.teams as teams_crud
from integrations import msgraph
from integrations.msgraph import GraphError
from logic import meeting_notes_logic, project_logic
from logic.audit import log_audit
from logic.schemas import ScrumCreate, TeamsImportResult, TeamsStatusOut

log = logging.getLogger("zet.teams")

_VTT_TS = re.compile(r"^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->")
# Teams embeds the speaker as <v Full Name>spoken text</v> inside each cue.
_VTT_VOICE = re.compile(r"<v\s+([^>]+)>(.*?)</v>", re.IGNORECASE | re.DOTALL)
_TAG = re.compile(r"<[^>]+>")


def _gate(db: Session, user_id: str) -> None:
    # Manager/admin only. The organizer whose meetings can be read is bounded by
    # the Teams application-access-policy granted in Azure (intentional trust
    # boundary): admins scope which organizers this app may pull, and any ZET
    # manager may import within that grant. Tighten the Azure policy to restrict.
    if not project_logic.is_managerial(db, user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only managers and admins can import Teams transcripts.")


def vtt_to_text(vtt: str) -> str:
    """Flatten WebVTT to clean 'Speaker: text' lines, collapsing consecutive lines
    from the same speaker. Drops the WEBVTT header, cue numbers and timestamps."""
    lines: list[tuple[str, str]] = []  # (speaker, text)
    for raw in (vtt or "").splitlines():
        line = raw.strip()
        if not line or line == "WEBVTT" or _VTT_TS.match(line) or line.isdigit():
            continue
        if line.startswith(("NOTE", "STYLE", "REGION")):
            continue
        m = _VTT_VOICE.search(line)
        if m:
            speaker = m.group(1).strip()
            text = _TAG.sub("", m.group(2)).strip()
        else:
            speaker = ""
            text = _TAG.sub("", line).strip()
        if not text:
            continue
        if lines and lines[-1][0] == speaker:
            lines[-1] = (speaker, f"{lines[-1][1]} {text}")
        else:
            lines.append((speaker, text))
    return "\n".join(f"{s}: {t}" if s else t for s, t in lines).strip()


def status_out(db: Session, user_id: str) -> TeamsStatusOut:
    _gate(db, user_id)
    return TeamsStatusOut(
        configured=msgraph.is_configured(),
        tenantConfigured=bool(config.MICROSOFT_TENANT_ID and config.MICROSOFT_TENANT_ID.lower() != "common"),
        clientConfigured=bool(config.MICROSOFT_CLIENT_ID),
        secretConfigured=bool(config.MICROSOFT_CLIENT_SECRET),
    )


def _transcript_date(transcript: dict, fallback: str | None) -> str:
    created = transcript.get("createdDateTime") or transcript.get("createdDateTimeUtc") or ""
    if created:
        try:
            return datetime.fromisoformat(created.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            pass
    return fallback or datetime.now(timezone.utc).date().isoformat()


def _ingest_transcript(
    db: Session,
    user_id: str,
    *,
    organizer_id: str,
    meeting_id: str,
    transcript: dict,
    date_override: str | None,
    title: str,
):
    """Download one transcript, parse to MOM, persist + record dedup. Returns the
    ScrumOut, or None when the transcript is empty/blank (nothing to store)."""
    transcript_id = transcript.get("id") or ""
    vtt = msgraph.transcript_content_vtt(organizer_id, meeting_id, transcript_id)
    text = vtt_to_text(vtt)
    work_date = date_override or _transcript_date(transcript, None)
    now = datetime.now(timezone.utc).isoformat()
    if not text:
        # Record (and commit) so a re-sync doesn't keep re-downloading an empty transcript.
        teams_crud.record(db, transcript_id=transcript_id, meeting_id=meeting_id,
                          scrum_id=None, imported_by=user_id, imported_at=now)
        db.commit()
        return None
    scrum = meeting_notes_logic.create_scrum(
        db, work_date, ScrumCreate(title=title, rawText=text), user_id
    )
    # Commit the dedup row immediately after the scrum (no I/O between the two
    # commits) so a failure on a LATER transcript can't leave this scrum without
    # its ledger row and cause a duplicate on the next run.
    teams_crud.record(db, transcript_id=transcript_id, meeting_id=meeting_id,
                      scrum_id=scrum.id, imported_by=user_id, imported_at=now)
    log_audit(db, user_id, "mom.teams_imported", "scrum", scrum.id,
              f"{title} · {work_date}", {"meetingId": meeting_id, "transcriptId": transcript_id})
    db.commit()
    return scrum


def import_meeting(
    db: Session,
    user_id: str,
    *,
    organizer_email: str,
    join_url: str,
    date: str | None = None,
    title: str | None = None,
) -> TeamsImportResult:
    """Import the latest (or all new) transcripts for ONE meeting by join link."""
    _gate(db, user_id)
    try:
        organizer = msgraph.get_user(organizer_email.strip())
        organizer_id = organizer["id"]
        meeting = msgraph.find_meeting_by_join_url(organizer_id, join_url.strip())
        meeting_id = meeting["id"]
        transcripts = msgraph.list_meeting_transcripts(organizer_id, meeting_id)
    except GraphError as e:
        raise HTTPException(e.status_code or 502, str(e))

    if not transcripts:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No transcript on that meeting yet. Transcription must be turned on and the "
            "meeting ended before a transcript is available.",
        )

    base_title = (title or meeting.get("subject") or "Teams Meeting").strip() or "Teams Meeting"
    scrums, skipped = [], 0
    for t in transcripts:
        tid = t.get("id") or ""
        if not tid or teams_crud.is_imported(db, tid):
            skipped += 1
            continue
        try:
            # Commits per-item inside _ingest_transcript, so an error on a later
            # transcript never rolls back an already-imported one.
            scrum = _ingest_transcript(db, user_id, organizer_id=organizer_id, meeting_id=meeting_id,
                                       transcript=t, date_override=date, title=base_title)
        except GraphError as e:
            raise HTTPException(e.status_code or 502, str(e))
        if scrum:
            scrums.append(scrum)
    return TeamsImportResult(
        imported=len(scrums), skipped=skipped, scrums=scrums,
        message=(f"Imported {len(scrums)} transcript(s)."
                 if scrums else "Nothing new to import — already up to date."),
    )


def sync_transcripts(
    db: Session,
    user_id: str,
    *,
    organizer_email: str,
    since: str | None = None,
) -> TeamsImportResult:
    """Automation: pull every not-yet-imported transcript across an organizer's
    meetings (getAllTranscripts). Idempotent via the dedup ledger."""
    _gate(db, user_id)
    try:
        organizer = msgraph.get_user(organizer_email.strip())
        organizer_id = organizer["id"]
        all_transcripts = msgraph.list_all_transcripts(organizer_id)
    except GraphError as e:
        raise HTTPException(e.status_code or 502, str(e))

    scrums, skipped = [], 0
    for t in all_transcripts:
        tid = t.get("id") or ""
        if not tid or teams_crud.is_imported(db, tid):
            skipped += 1
            continue
        tdate = _transcript_date(t, None)
        if since and tdate < since:
            skipped += 1
            continue
        meeting_id = t.get("meetingId") or ""
        if not meeting_id:
            skipped += 1
            continue
        try:
            scrum = _ingest_transcript(db, user_id, organizer_id=organizer_id, meeting_id=meeting_id,
                                       transcript=t, date_override=None, title="Teams Meeting")
        except GraphError as e:
            log.warning("skip transcript %s: %s", tid, e)
            skipped += 1
            continue
        if scrum:
            scrums.append(scrum)
    return TeamsImportResult(
        imported=len(scrums), skipped=skipped, scrums=scrums,
        message=f"Imported {len(scrums)} new transcript(s); skipped {skipped}.",
    )
