from database.models import Scrum

from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models

_SELECT = """SELECT id, work_date, title, position, raw_text, parsed_json, parse_status,
    updated_by, updated_at, created_at FROM scrums"""


def get_by_id(db: Db, scrum_id: str) -> Scrum | None:
    return row_to_model(
        Scrum,
        fetch_one(db, f"{_SELECT} WHERE id = %s", (scrum_id,)),
    )


def list_for_date(db: Db, work_date: str) -> list[Scrum]:
    rows = fetch_all(
        db,
        f"{_SELECT} WHERE work_date = %s ORDER BY position ASC, created_at ASC",
        (work_date,),
    )
    return rows_to_models(Scrum, rows)


def list_for_range(db: Db, start: str, end: str) -> list[Scrum]:
    rows = fetch_all(
        db,
        f"""{_SELECT}
            WHERE work_date >= %s AND work_date <= %s
            ORDER BY work_date ASC, position ASC""",
        (start, end),
    )
    return rows_to_models(Scrum, rows)


def next_position(db: Db, work_date: str) -> int:
    return len(list_for_date(db, work_date))


def create(
    db: Db,
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
    db.write(
        """INSERT INTO scrums
            (id, work_date, title, position, raw_text, parsed_json, parse_status,
             updated_by, updated_at, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            scrum_id,
            work_date,
            title,
            position,
            raw_text,
            parsed_json,
            parse_status,
            updated_by,
            updated_at,
            created_at,
        ),
    )
    return Scrum(
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


def update(db: Db, scrum: Scrum) -> Scrum:
    db.write(
        """UPDATE scrums SET
            work_date = %s, title = %s, position = %s, raw_text = %s, parsed_json = %s,
            parse_status = %s, updated_by = %s, updated_at = %s, created_at = %s
            WHERE id = %s""",
        (
            scrum.work_date,
            scrum.title,
            scrum.position,
            scrum.raw_text,
            scrum.parsed_json,
            scrum.parse_status,
            scrum.updated_by,
            scrum.updated_at,
            scrum.created_at,
            scrum.id,
        ),
    )
    return scrum


def delete(db: Db, scrum_id: str) -> None:
    db.write("DELETE FROM scrums WHERE id = %s", (scrum_id,))
