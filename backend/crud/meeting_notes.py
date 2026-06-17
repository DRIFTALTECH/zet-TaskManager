from sqlalchemy.orm import Session

from database.models import Scrum


def get_by_id(db: Session, scrum_id: str) -> Scrum | None:
    return db.query(Scrum).get(scrum_id)


def list_for_date(db: Session, work_date: str) -> list[Scrum]:
    return (
        db.query(Scrum)
        .filter(Scrum.work_date == work_date)
        .order_by(Scrum.position.asc(), Scrum.created_at.asc())
        .all()
    )


def list_for_range(db: Session, start: str, end: str) -> list[Scrum]:
    return (
        db.query(Scrum)
        .filter(Scrum.work_date >= start, Scrum.work_date <= end)
        .order_by(Scrum.work_date.asc(), Scrum.position.asc())
        .all()
    )


def next_position(db: Session, work_date: str) -> int:
    return len(list_for_date(db, work_date))


def create(
    db: Session,
    *,
    scrum_id: str,
    work_date: str,
    title: str,
    position: int,
    raw_text: str,
    parsed_json: str,
    parse_status: str,
    updated_by: str,
    updated_at: str,
    created_at: str,
) -> Scrum:
    s = Scrum(
        id=scrum_id,
        work_date=work_date,
        title=title,
        position=position,
        raw_text=raw_text,
        parsed_json=parsed_json,
        parse_status=parse_status,
        updated_by=updated_by,
        updated_at=updated_at,
        created_at=created_at,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def update(db: Session, scrum: Scrum) -> Scrum:
    db.add(scrum)
    db.commit()
    db.refresh(scrum)
    return scrum


def delete(db: Session, scrum_id: str) -> None:
    db.query(Scrum).filter(Scrum.id == scrum_id).delete()
    db.commit()
