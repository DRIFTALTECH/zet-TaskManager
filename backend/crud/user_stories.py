"""CRUD for user_stories — all SQL for this table lives here."""
from __future__ import annotations

import realtime
from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import UserStory
from db_wrapper.dialect import use_sqlite

_BOARD_COLS = ("sprint", "tags_json", "approved_by_manager")
_has_board_cols: bool | None = None
_has_sidecar: bool | None = None


def _story_has_board_cols(db: Db) -> bool:
    """Aurora app_user cannot ALTER user_stories; extras exist only after an owner migration."""
    global _has_board_cols
    if _has_board_cols is not None:
        return _has_board_cols
    if use_sqlite():
        rows = fetch_all(db, "PRAGMA table_info(user_stories)")
        names = {r.get("name") for r in rows}
    else:
        rows = fetch_all(
            db,
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'user_stories'
              AND column_name = ANY(%s)
            """,
            (list(_BOARD_COLS),),
        )
        names = {r["column_name"] for r in rows}
    _has_board_cols = all(c in names for c in _BOARD_COLS)
    return _has_board_cols


def _story_has_sidecar(db: Db) -> bool:
    global _has_sidecar
    if _has_sidecar is not None:
        return _has_sidecar
    if use_sqlite():
        rows = fetch_all(
            db,
            "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = %s",
            ("user_story_board",),
        )
    else:
        rows = fetch_all(
            db,
            """
            SELECT 1 AS ok FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = %s
            """,
            ("user_story_board",),
        )
    _has_sidecar = bool(rows)
    return _has_sidecar


def _board_vals(story: UserStory) -> tuple[str, str, bool]:
    return (
        getattr(story, "sprint", None) or "",
        getattr(story, "tags_json", None) or "[]",
        bool(getattr(story, "approved_by_manager", False)),
    )


def _upsert_board(db: Db, story_id: str, sprint: str, tags_json: str, approved: bool) -> None:
    db.write("DELETE FROM user_story_board WHERE story_id = %s", (story_id,))
    db.write(
        """
        INSERT INTO user_story_board (story_id, sprint, tags_json, approved_by_manager)
        VALUES (%s, %s, %s, %s)
        """,
        (story_id, sprint or "", tags_json or "[]", bool(approved)),
    )


def _hydrate(db: Db, stories: list[UserStory]) -> None:
    if not stories or _story_has_board_cols(db) or not _story_has_sidecar(db):
        return
    rows = fetch_all(
        db,
        """
        SELECT story_id, sprint, tags_json, approved_by_manager
        FROM user_story_board WHERE story_id = ANY(%s)
        """,
        ([s.id for s in stories],),
    )
    by_id = {r["story_id"]: r for r in rows}
    for s in stories:
        b = by_id.get(s.id)
        if not b:
            continue
        s.sprint = b.get("sprint") or ""
        s.tags_json = b.get("tags_json") or "[]"
        s.approved_by_manager = bool(b.get("approved_by_manager"))


def get_by_id(db: Db, story_id: str) -> UserStory | None:
    s = row_to_model(
        UserStory,
        fetch_one(db, "SELECT * FROM user_stories WHERE id = %s", (story_id,)),
    )
    if s:
        _hydrate(db, [s])
    return s


def list_all(db: Db) -> list[UserStory]:
    rows = rows_to_models(
        UserStory,
        fetch_all(db, "SELECT * FROM user_stories ORDER BY created_at DESC"),
    )
    _hydrate(db, rows)
    return rows


def list_for_member_projects(db: Db, user_id: str) -> list[UserStory]:
    """Stories in any project the user is a member of — filtered in SQL via a join."""
    rows = rows_to_models(
        UserStory,
        fetch_all(
            db,
            """
            SELECT us.* FROM user_stories us
            INNER JOIN project_members pm ON pm.project_id = us.project_id
            WHERE pm.user_id = %s
            ORDER BY us.created_at DESC
            """,
            (user_id,),
        ),
    )
    _hydrate(db, rows)
    return rows


def list_for_project(db: Db, project_id: str) -> list[UserStory]:
    rows = rows_to_models(
        UserStory,
        fetch_all(
            db,
            "SELECT * FROM user_stories WHERE project_id = %s ORDER BY created_at DESC",
            (project_id,),
        ),
    )
    _hydrate(db, rows)
    return rows


def list_for_section(db: Db, section_id: str) -> list[UserStory]:
    rows = rows_to_models(
        UserStory,
        fetch_all(
            db,
            "SELECT * FROM user_stories WHERE section_id = %s ORDER BY created_at DESC",
            (section_id,),
        ),
    )
    _hydrate(db, rows)
    return rows


def list_active_for_projects(db: Db, project_ids: list[str]) -> list[UserStory]:
    """Incomplete user stories in the given projects (same active filter as task forecast)."""
    if not project_ids:
        return []
    rows = rows_to_models(
        UserStory,
        fetch_all(
            db,
            """
            SELECT * FROM user_stories
            WHERE project_id = ANY(%s)
              AND LOWER(TRIM(status)) NOT IN ('completed', 'done', 'cancelled', 'archived', 'closed')
            ORDER BY created_at DESC
            """,
            (project_ids,),
        ),
    )
    _hydrate(db, rows)
    return rows


def create(
    db: Db,
    *,
    story_id: str,
    project_id: str,
    section_id: str | None,
    title: str,
    description: str,
    acceptance_criteria: str,
    priority: str,
    status: str,
    assignee_id: str | None,
    reporter_id: str,
    estimated_hours: str | None,
    story_points: str | None,
    start_date: str | None,
    due_date: str | None,
    created_at: str,
    updated_at: str,
    sprint: str = "",
    tags_json: str = "[]",
    approved_by_manager: bool = False,
) -> UserStory:
    extras = _story_has_board_cols(db)
    if extras:
        db.write(
            """
            INSERT INTO user_stories (
                id, project_id, section_id, title, description, acceptance_criteria,
                priority, status, assignee_id, reporter_id, estimated_hours, story_points,
                start_date, due_date, sprint, tags_json, approved_by_manager,
                created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s
            )
            """,
            (
                story_id, project_id, section_id, title, description, acceptance_criteria,
                priority, status, assignee_id, reporter_id, estimated_hours, story_points,
                start_date, due_date, sprint or "", tags_json or "[]", bool(approved_by_manager),
                created_at, updated_at,
            ),
        )
    else:
        db.write(
            """
            INSERT INTO user_stories (
                id, project_id, section_id, title, description, acceptance_criteria,
                priority, status, assignee_id, reporter_id, estimated_hours, story_points,
                start_date, due_date, created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s
            )
            """,
            (
                story_id, project_id, section_id, title, description, acceptance_criteria,
                priority, status, assignee_id, reporter_id, estimated_hours, story_points,
                start_date, due_date, created_at, updated_at,
            ),
        )
        _upsert_board(db, story_id, sprint or "", tags_json or "[]", bool(approved_by_manager))
    realtime.bump("tasks")
    return get_by_id(db, story_id)  # type: ignore[return-value]


def update(db: Db, story: UserStory) -> UserStory:
    sprint, tags_json, approved = _board_vals(story)
    if _story_has_board_cols(db):
        db.write(
            """
            UPDATE user_stories SET
                project_id = %s, section_id = %s, title = %s, description = %s,
                acceptance_criteria = %s, priority = %s, status = %s,
                assignee_id = %s, reporter_id = %s, estimated_hours = %s,
                story_points = %s, start_date = %s, due_date = %s,
                sprint = %s, tags_json = %s, approved_by_manager = %s, updated_at = %s
            WHERE id = %s
            """,
            (
                story.project_id, story.section_id, story.title, story.description,
                story.acceptance_criteria, story.priority, story.status,
                story.assignee_id, story.reporter_id, story.estimated_hours,
                story.story_points, story.start_date, story.due_date,
                sprint, tags_json, approved,
                story.updated_at, story.id,
            ),
        )
    else:
        db.write(
            """
            UPDATE user_stories SET
                project_id = %s, section_id = %s, title = %s, description = %s,
                acceptance_criteria = %s, priority = %s, status = %s,
                assignee_id = %s, reporter_id = %s, estimated_hours = %s,
                story_points = %s, start_date = %s, due_date = %s, updated_at = %s
            WHERE id = %s
            """,
            (
                story.project_id, story.section_id, story.title, story.description,
                story.acceptance_criteria, story.priority, story.status,
                story.assignee_id, story.reporter_id, story.estimated_hours,
                story.story_points, story.start_date, story.due_date,
                story.updated_at, story.id,
            ),
        )
        _upsert_board(db, story.id, sprint, tags_json, approved)
    realtime.bump("tasks")
    return get_by_id(db, story.id)  # type: ignore[return-value]


def delete(db: Db, story_id: str) -> None:
    # Tasks keep rows; FK ON DELETE SET NULL clears user_story_id.
    if _story_has_sidecar(db):
        db.write("DELETE FROM user_story_board WHERE story_id = %s", (story_id,))
    db.write("DELETE FROM user_stories WHERE id = %s", (story_id,))
    realtime.bump("tasks")
