"""Scrum / meeting-notes (MOM) logic: many scrums per day, AI-parsed per person.

Each scrum stores raw text + a parsed {members, summary} breakdown. Saving raw
text auto-parses via the AI agent; the parsed result can also be hand-edited."""

import json
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import crud.meeting_notes as scrums_crud
import crud.users as users_crud
from ai import chains, service
from database.init_db import new_id
from database.models import Scrum
from logic.audit import log_audit
from logic.schemas import MomMemberOut, ScrumCreate, ScrumDaySummary, ScrumOut, ScrumUpdate


def _parsed(scrum: Scrum) -> dict:
    try:
        data = json.loads(scrum.parsed_json or "{}")
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}


def _members_from(data: dict) -> list[MomMemberOut]:
    out: list[MomMemberOut] = []
    for m in data.get("members", []) or []:
        if not isinstance(m, dict):
            continue
        name = str(m.get("name", "")).strip()
        items = [str(i) for i in (m.get("items") or []) if str(i).strip()]
        if name:
            out.append(MomMemberOut(name=name, items=items))
    return out


def _name_for(db: Session, user_id: str | None) -> str:
    if not user_id:
        return ""
    u = users_crud.get_by_id(db, user_id)
    return u.name if u else ""


def to_out(db: Session, scrum: Scrum) -> ScrumOut:
    data = _parsed(scrum)
    return ScrumOut(
        id=scrum.id,
        date=scrum.work_date,
        title=scrum.title or "Scrum",
        rawText=scrum.raw_text or "",
        members=_members_from(data),
        summary=str(data.get("summary", "") or ""),
        parseStatus=scrum.parse_status or "empty",
        updatedBy=scrum.updated_by,
        updatedByName=_name_for(db, scrum.updated_by),
        updatedAt=scrum.updated_at or "",
    )


def list_for_date(db: Session, work_date: str) -> list[ScrumOut]:
    return [to_out(db, s) for s in scrums_crud.list_for_date(db, work_date)]


def list_range(db: Session, start: str, end: str) -> list[ScrumDaySummary]:
    rows = scrums_crud.list_for_range(db, start, end)
    by_date: dict[str, list[Scrum]] = {}
    for s in rows:
        by_date.setdefault(s.work_date, []).append(s)
    out: list[ScrumDaySummary] = []
    for date, scrums in by_date.items():
        member_total = sum(len(_members_from(_parsed(s))) for s in scrums)
        first_summary = next((str(_parsed(s).get("summary", "")) for s in scrums if _parsed(s).get("summary")), "")
        status_val = "ok" if any(s.parse_status == "ok" for s in scrums) else (scrums[0].parse_status if scrums else "empty")
        out.append(ScrumDaySummary(
            date=date,
            scrumCount=len(scrums),
            memberCount=member_total,
            summary=first_summary,
            parseStatus=status_val,
            updatedByName=_name_for(db, scrums[-1].updated_by),
        ))
    out.sort(key=lambda x: x.date)
    return out


# Audio formats accepted for a dropped meeting recording (same set the task
# extractor accepts — both go through the same Groq Whisper model).
AUDIO_EXT = {"mp3", "wav", "m4a", "webm", "ogg", "oga", "flac", "mp4", "mpeg", "mpga", "aac"}


def _ext(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def transcribe_audio(audio_bytes: bytes, filename: str | None) -> str:
    """Speech-to-text for a dropped meeting recording, via the same Groq Whisper
    model task extraction uses (service.transcribe). Returns the raw transcript so
    the user can review/edit it before it is parsed into the per-person MOM."""
    if not audio_bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No audio uploaded.")
    if _ext(filename) not in AUDIO_EXT:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported audio format.")
    text = (service.transcribe(audio_bytes, filename or "audio.webm") or "").strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Could not transcribe audio — empty result.")
    return text


def _parse_to_json(raw_text: str) -> tuple[str, str]:
    """Returns (parsed_json, parse_status) for the given raw text."""
    raw_text = (raw_text or "").strip()
    if not raw_text:
        return "", "empty"
    try:
        result = chains.parse_meeting_notes(raw_text)
        return json.dumps(result.model_dump()), "ok"
    except Exception:
        return json.dumps({"members": [], "summary": ""}), "failed"


def create_scrum(db: Session, work_date: str, body: ScrumCreate, user_id: str) -> ScrumOut:
    raw = (body.rawText or "").strip()
    parsed_json, status_val = _parse_to_json(raw)
    now = datetime.now(timezone.utc).isoformat()
    scrum = scrums_crud.create(
        db,
        scrum_id=new_id("scrum"),
        work_date=work_date,
        title=(body.title or "Scrum").strip() or "Scrum",
        position=scrums_crud.next_position(db, work_date),
        raw_text=raw,
        parsed_json=parsed_json,
        parse_status=status_val,
        updated_by=user_id,
        updated_at=now,
        created_at=now,
    )
    out = to_out(db, scrum)
    log_audit(db, user_id, "mom.created", "scrum", out.id, f"{out.title} · {work_date}",
              {"parseStatus": out.parseStatus, "members": len(out.members)})
    db.commit()
    return out


def update_scrum(db: Session, scrum_id: str, body: ScrumUpdate, user_id: str) -> ScrumOut:
    scrum = scrums_crud.get_by_id(db, scrum_id)
    if scrum is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scrum not found")

    if body.title is not None:
        scrum.title = body.title.strip() or "Scrum"

    if body.members is not None or body.summary is not None:
        # Manual edit of the parsed breakdown — no re-parsing.
        current = _parsed(scrum)
        members = (
            [{"name": m.name, "items": m.items} for m in body.members]
            if body.members is not None
            else current.get("members", [])
        )
        summary = body.summary if body.summary is not None else current.get("summary", "")
        scrum.parsed_json = json.dumps({"members": members, "summary": summary})
        scrum.parse_status = "ok"
    elif body.rawText is not None:
        # Raw text changed → re-parse with the AI agent.
        scrum.raw_text = body.rawText.strip()
        scrum.parsed_json, scrum.parse_status = _parse_to_json(scrum.raw_text)

    scrum.updated_by = user_id
    scrum.updated_at = datetime.now(timezone.utc).isoformat()
    scrums_crud.update(db, scrum)
    out = to_out(db, scrum)
    log_audit(db, user_id, "mom.updated", "scrum", out.id, f"{out.title} · {out.date}",
              {"parseStatus": out.parseStatus, "members": len(out.members)})
    db.commit()
    return out


def reparse_scrum(db: Session, scrum_id: str, user_id: str) -> ScrumOut:
    scrum = scrums_crud.get_by_id(db, scrum_id)
    if scrum is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scrum not found")
    scrum.parsed_json, scrum.parse_status = _parse_to_json(scrum.raw_text)
    scrum.updated_by = user_id
    scrum.updated_at = datetime.now(timezone.utc).isoformat()
    scrums_crud.update(db, scrum)
    return to_out(db, scrum)


def delete_scrum(db: Session, scrum_id: str, user_id: str) -> None:
    if scrums_crud.get_by_id(db, scrum_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scrum not found")
    scrums_crud.delete(db, scrum_id)
    log_audit(db, user_id, "mom.deleted", "scrum", scrum_id, scrum_id, {})
    db.commit()
