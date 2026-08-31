"""CRUD for temp_tasks — PRD import staging. All SQL for this table lives here."""
from __future__ import annotations

from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import TempTask


def get_by_id(db: Db, row_id: str) -> TempTask | None:
    return row_to_model(
        TempTask,
        fetch_one(db, "SELECT * FROM temp_tasks WHERE id = %s", (row_id,)),
    )


def list_for_user(db: Db, user_id: str) -> list[TempTask]:
    return rows_to_models(
        TempTask,
        fetch_all(
            db,
            """
            SELECT * FROM temp_tasks
            WHERE user_id = %s
            ORDER BY kind ASC, position ASC, created_at ASC
            """,
            (user_id,),
        ),
    )


def list_for_import(db: Db, import_id: str) -> list[TempTask]:
    return rows_to_models(
        TempTask,
        fetch_all(
            db,
            """
            SELECT * FROM temp_tasks
            WHERE import_id = %s
            ORDER BY kind ASC, position ASC, created_at ASC
            """,
            (import_id,),
        ),
    )


def create(
    db: Db,
    *,
    row_id: str,
    import_id: str,
    user_id: str,
    kind: str,
    parent_id: str | None,
    title: str,
    description: str,
    acceptance_criteria: str,
    project_id: str | None,
    section_id: str | None,
    priority: str,
    position: int,
    source_text: str,
    created_at: str,
    updated_at: str,
) -> TempTask:
    db.write(
        """
        INSERT INTO temp_tasks (
            id, import_id, user_id, kind, parent_id, title, description,
            acceptance_criteria, project_id, section_id, priority, position,
            source_text, created_at, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s
        )
        """,
        (
            row_id,
            import_id,
            user_id,
            kind,
            parent_id,
            title,
            description,
            acceptance_criteria,
            project_id,
            section_id,
            priority,
            position,
            source_text,
            created_at,
            updated_at,
        ),
    )
    return get_by_id(db, row_id)  # type: ignore[return-value]


def update(db: Db, row: TempTask) -> TempTask:
    db.write(
        """
        UPDATE temp_tasks SET
            title = %s, description = %s, acceptance_criteria = %s,
            project_id = %s, section_id = %s, priority = %s, position = %s,
            parent_id = %s, updated_at = %s
        WHERE id = %s
        """,
        (
            row.title,
            row.description,
            row.acceptance_criteria,
            row.project_id,
            row.section_id,
            row.priority,
            row.position,
            row.parent_id,
            row.updated_at,
            row.id,
        ),
    )
    return get_by_id(db, row.id)  # type: ignore[return-value]


def delete(db: Db, row_id: str) -> None:
    db.write("DELETE FROM temp_tasks WHERE id = %s", (row_id,))


def delete_children(db: Db, parent_id: str) -> None:
    db.write("DELETE FROM temp_tasks WHERE parent_id = %s", (parent_id,))


def delete_for_user(db: Db, user_id: str) -> None:
    db.write("DELETE FROM temp_tasks WHERE user_id = %s", (user_id,))
