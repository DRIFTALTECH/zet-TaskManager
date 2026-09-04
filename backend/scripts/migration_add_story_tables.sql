-- Everything this app needs that `app_user` cannot create for itself.
--
-- The service boots as a least-privilege IAM role with no CREATE on schema
-- public, so init_db() logs the denial and carries on. Run this once as the
-- table owner (postgres) to bring the schema up to date:
--
--     psql "$DATABASE_URL" -f scripts/migration_add_story_tables.sql
--
-- Every statement is idempotent — re-running it is a no-op.

BEGIN;

-- ── Comments on a user story (mirrors task_feedback) ────────────────────────
CREATE TABLE IF NOT EXISTS user_story_feedback (
    id            VARCHAR PRIMARY KEY,
    user_story_id VARCHAR NOT NULL REFERENCES user_stories (id) ON DELETE CASCADE,
    user_id       VARCHAR NOT NULL REFERENCES users (id),
    message       TEXT    NOT NULL,
    created_at    VARCHAR NOT NULL,
    updated_at    VARCHAR NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_user_story_feedback_story
    ON user_story_feedback (user_story_id);

-- ── A timesheet row remembers the task it came from ─────────────────────────
-- Lets the hours entered when closing a task replace that task's earlier row
-- instead of appending a second one.
ALTER TABLE timesheet_entries ADD COLUMN IF NOT EXISTS task_id VARCHAR;
CREATE INDEX IF NOT EXISTS ix_timesheet_entries_task
    ON timesheet_entries (task_id);

-- ── A story may sit under another story (epic → story) ──────────────────────
ALTER TABLE user_stories ADD COLUMN IF NOT EXISTS parent_story_id VARCHAR;
CREATE INDEX IF NOT EXISTS ix_user_stories_parent
    ON user_stories (parent_story_id);

-- ── Let the app role use them ───────────────────────────────────────────────
-- Without this the table exists but every read from app_user is denied.
GRANT SELECT, INSERT, UPDATE, DELETE ON user_story_feedback TO app_user;

COMMIT;

-- Verify:
--   \d user_story_feedback
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name IN ('timesheet_entries','user_stories')
--      AND column_name IN ('task_id','parent_story_id');
