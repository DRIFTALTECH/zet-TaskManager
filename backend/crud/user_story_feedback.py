from database.models import UserStoryFeedback

from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models

_SELECT = """SELECT id, user_story_id, user_id, message, created_at, updated_at
    FROM user_story_feedback"""


def list_for_story(db: Db, story_id: str) -> list[UserStoryFeedback]:
    rows = fetch_all(
        db,
        f"{_SELECT} WHERE user_story_id = %s ORDER BY created_at ASC",
        (story_id,),
    )
    return rows_to_models(UserStoryFeedback, rows)


def get_by_id(db: Db, feedback_id: str) -> UserStoryFeedback | None:
    return row_to_model(
        UserStoryFeedback,
        fetch_one(db, f"{_SELECT} WHERE id = %s", (feedback_id,)),
    )


def create_row(db: Db, row: UserStoryFeedback) -> UserStoryFeedback:
    db.write(
        """INSERT INTO user_story_feedback
            (id, user_story_id, user_id, message, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)""",
        (row.id, row.user_story_id, row.user_id, row.message, row.created_at, row.updated_at),
    )
    return row


def update_row(db: Db, row: UserStoryFeedback) -> UserStoryFeedback:
    db.write(
        """UPDATE user_story_feedback SET
            user_story_id = %s, user_id = %s, message = %s, created_at = %s, updated_at = %s
            WHERE id = %s""",
        (row.user_story_id, row.user_id, row.message, row.created_at, row.updated_at, row.id),
    )
    return row


def delete_row(db: Db, row: UserStoryFeedback) -> None:
    db.write("DELETE FROM user_story_feedback WHERE id = %s", (row.id,))
