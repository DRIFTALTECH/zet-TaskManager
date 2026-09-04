"""Every query for user stories. The rows live in `work_items`.

A story is a work item with `type = 'story'`, so this module maps that shape
back to the `UserStory` object its callers expect and their signatures are
unchanged.

WHAT DISAPPEARED
    The old table could not be altered by the app's IAM role, so sprint, tags,
    approval and the parent link were packed into `estimated_hours` as a JSON
    blob prefixed "usb:" whenever the real columns were missing, and unpacked
    again on the way out. `work_items` is created once, by the owner, with every
    column present — so the packing, the unpacking, the two capability probes
    and their module-level caches are all gone.
"""
from __future__ import annotations

import realtime
from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import UserStory

# Story-shaped projection of a work item. A story's parent is always another
# story, so unlike a task there is nothing to disambiguate.
_COLS = """
    w.id, w.project_id, w.section_id, w.parent_id AS parent_story_id,
    w.title, w.description, w.acceptance_criteria, w.priority, w.status,
    w.assigned_to AS assignee_id, w.created_by AS reporter_id,
    w.estimated_hours, w.story_points, w.start_date, w.due_date,
    w.sprint, w.tags_json, w.approved_by_manager, w.created_at, w.updated_at
"""

_IS_STORY = "w.type = 'story'"


# Story-shaped relation for modules that write SQL of their own, substituted
# wherever `user_stories` used to be named.
STORY_RELATION = f"(SELECT {_COLS} FROM work_items w WHERE {_IS_STORY})"


def _select(where: str = "", order: str = "ORDER BY w.created_at DESC") -> str:
    clause = f"AND ({where})" if where else ""
    return f"SELECT {_COLS} FROM work_items w WHERE {_IS_STORY} {clause} {order}"


def get_by_id(db: Db, story_id: str) -> UserStory | None:
    return row_to_model(UserStory, fetch_one(db, _select("w.id = %s", ""), (story_id,)))


def list_all(db: Db) -> list[UserStory]:
    return rows_to_models(UserStory, fetch_all(db, _select()))


def list_for_member_projects(db: Db, user_id: str) -> list[UserStory]:
    """Stories in any project the user is a member of — filtered in SQL via a join."""
    return rows_to_models(
        UserStory,
        fetch_all(
            db,
            f"""
            SELECT {_COLS} FROM work_items w
            INNER JOIN project_members pm ON pm.project_id = w.project_id
            WHERE {_IS_STORY} AND pm.user_id = %s
            ORDER BY w.created_at DESC
            """,
            (user_id,),
        ),
    )


def list_for_project(db: Db, project_id: str) -> list[UserStory]:
    return rows_to_models(UserStory, fetch_all(db, _select("w.project_id = %s"), (project_id,)))


def list_for_section(db: Db, section_id: str) -> list[UserStory]:
    return rows_to_models(UserStory, fetch_all(db, _select("w.section_id = %s"), (section_id,)))


def list_active_for_projects(db: Db, project_ids: list[str]) -> list[UserStory]:
    """Incomplete user stories in the given projects (same active filter as task forecast)."""
    if not project_ids:
        return []
    return rows_to_models(
        UserStory,
        fetch_all(
            db,
            _select(
                """
                w.project_id = ANY(%s)
                AND LOWER(TRIM(w.status)) NOT IN
                    ('completed', 'done', 'cancelled', 'archived', 'closed')
                """
            ),
            (project_ids,),
        ),
    )


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
    parent_story_id: str | None = None,
) -> UserStory:
    db.write(
        """
        INSERT INTO work_items (
            id, type, parent_id, project_id, section_id, title, description,
            priority, status, due_date, sprint, tags_json, estimated_hours,
            approved_by_manager, created_by, created_at, updated_at,
            assigned_to, assigned_by, is_started, started_at, completed_at,
            time_tracked, min_log_minutes, custom_fields_json,
            acceptance_criteria, story_points, start_date
        ) VALUES (
            %s, 'story', %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, NULL, FALSE, NULL, NULL,
            0, 1, '{}',
            %s, %s, %s
        )
        """,
        (
            story_id, parent_story_id or None, project_id, section_id, title, description,
            priority, status, due_date, sprint or "", tags_json or "[]", estimated_hours,
            bool(approved_by_manager), reporter_id, created_at, updated_at,
            assignee_id,
            acceptance_criteria or "", story_points, start_date,
        ),
    )
    realtime.bump("user_stories")
    return get_by_id(db, story_id)  # type: ignore[return-value]


def update(db: Db, story: UserStory) -> UserStory:
    db.write(
        """
        UPDATE work_items SET
            parent_id = %s, project_id = %s, section_id = %s, title = %s,
            description = %s, acceptance_criteria = %s, priority = %s,
            status = %s, assigned_to = %s, created_by = %s,
            estimated_hours = %s, story_points = %s, start_date = %s,
            due_date = %s, sprint = %s, tags_json = %s,
            approved_by_manager = %s, updated_at = %s
        WHERE id = %s AND type = 'story'
        """,
        (
            getattr(story, "parent_story_id", None) or None,
            story.project_id,
            story.section_id,
            story.title,
            story.description,
            story.acceptance_criteria or "",
            story.priority,
            story.status,
            getattr(story, "assignee_id", None),
            story.reporter_id,
            getattr(story, "estimated_hours", None),
            getattr(story, "story_points", None),
            getattr(story, "start_date", None),
            story.due_date,
            getattr(story, "sprint", "") or "",
            getattr(story, "tags_json", None) or "[]",
            bool(getattr(story, "approved_by_manager", False)),
            story.updated_at,
            story.id,
        ),
    )
    realtime.bump("user_stories")
    return get_by_id(db, story.id)  # type: ignore[return-value]


def delete(db: Db, story_id: str) -> None:
    db.write("DELETE FROM work_items WHERE id = %s AND type = 'story'", (story_id,))
    realtime.bump("user_stories")


def list_children(db: Db, parent_story_id: str) -> list[UserStory]:
    return rows_to_models(
        UserStory, fetch_all(db, _select("w.parent_id = %s"), (parent_story_id,))
    )
