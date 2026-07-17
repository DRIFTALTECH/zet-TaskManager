"""CRUD for user_stories — all SQL for this table lives here."""
from __future__ import annotations

from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import UserStory


def get_by_id(db: Db, story_id: str) -> UserStory | None:
    return row_to_model(
        UserStory,
        fetch_one(db, "SELECT * FROM user_stories WHERE id = %s", (story_id,)),
    )


def list_for_project(db: Db, project_id: str) -> list[UserStory]:
    return rows_to_models(
        UserStory,
        fetch_all(
            db,
            "SELECT * FROM user_stories WHERE project_id = %s ORDER BY created_at DESC",
            (project_id,),
        ),
    )


def list_for_section(db: Db, section_id: str) -> list[UserStory]:
    return rows_to_models(
        UserStory,
        fetch_all(
            db,
            "SELECT * FROM user_stories WHERE section_id = %s ORDER BY created_at DESC",
            (section_id,),
        ),
    )


def list_active_for_projects(db: Db, project_ids: list[str]) -> list[UserStory]:
    """Incomplete user stories in the given projects (same active filter as task forecast)."""
    if not project_ids:
        return []
    return rows_to_models(
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


def create(
    db: Db,
    *,
    story_id: str,
    project_id: str,
    section_id: str,
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
) -> UserStory:
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
            story_id,
            project_id,
            section_id,
            title,
            description,
            acceptance_criteria,
            priority,
            status,
            assignee_id,
            reporter_id,
            estimated_hours,
            story_points,
            start_date,
            due_date,
            created_at,
            updated_at,
        ),
    )
    return get_by_id(db, story_id)  # type: ignore[return-value]


def update(db: Db, story: UserStory) -> UserStory:
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
            story.project_id,
            story.section_id,
            story.title,
            story.description,
            story.acceptance_criteria,
            story.priority,
            story.status,
            story.assignee_id,
            story.reporter_id,
            story.estimated_hours,
            story.story_points,
            story.start_date,
            story.due_date,
            story.updated_at,
            story.id,
        ),
    )
    return get_by_id(db, story.id)  # type: ignore[return-value]


def delete(db: Db, story_id: str) -> None:
    # Tasks keep rows; FK ON DELETE SET NULL clears user_story_id.
    db.write("DELETE FROM user_stories WHERE id = %s", (story_id,))
