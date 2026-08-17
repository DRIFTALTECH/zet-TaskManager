from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models

import realtime
from database.models import Section


def list_for_project(db: Db, project_id: str) -> list[Section]:
    rows = fetch_all(
        db,
        "SELECT * FROM sections WHERE project_id = %s ORDER BY name",
        (project_id,),
    )
    return rows_to_models(Section, rows)


def find_by_name(db: Db, project_id: str, name: str) -> Section | None:
    """Case-insensitive name lookup inside one project, for name-based imports."""
    row = fetch_one(
        db,
        "SELECT * FROM sections WHERE project_id = %s AND LOWER(TRIM(name)) = %s LIMIT 1",
        (project_id, name.strip().lower()),
    )
    return row_to_model(Section, row)


def get_by_id(db: Db, section_id: str) -> Section | None:
    row = fetch_one(db, "SELECT * FROM sections WHERE id = %s", (section_id,))
    return row_to_model(Section, row)


def create_section(db: Db, *, section_id: str, name: str, project_id: str) -> Section:
    db.write(
        "INSERT INTO sections (id, name, project_id) VALUES (%s, %s, %s)",
        (section_id, name, project_id),
    )
    realtime.bump("projects")
    created = get_by_id(db, section_id)
    assert created is not None
    return created


def delete_section(db: Db, section_id: str) -> None:
    row = fetch_one(db, "SELECT id FROM sections WHERE id = %s", (section_id,))
    if row:
        db.write("DELETE FROM sections WHERE id = %s", (section_id,))
        realtime.bump("projects")
