-- ZET Aurora/Postgres schema bootstrap — the whole schema, idempotent.
--
-- Run as the OWNER (postgres), not as the app's IAM role: the service connects
-- with no DDL rights and cannot create or alter anything for itself, so what is
-- missing here can never appear at runtime.
--
--     psql "$DATABASE_URL" -f scripts/bootstrap_aurora.sql
--
-- Wiping and redeploying:
--     1. aws rds create-db-cluster-snapshot ...        (take a snapshot first)
--     2. python scripts/wipe_data.py --apply           (clears rows, keeps schema)
--     3. psql ... -f scripts/bootstrap_aurora.sql      (adds anything new)
--     4. python scripts/seed_superadmin.py --apply     (one account to log in with)
--
-- `tests/test_bootstrap_schema.py` fails if this file falls behind the models.

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    email VARCHAR NOT NULL UNIQUE,
    password_hash VARCHAR NOT NULL,
    role VARCHAR NOT NULL,
    avatar VARCHAR NOT NULL DEFAULT '',
    job_title VARCHAR NOT NULL DEFAULT '',
    experience_months INTEGER NOT NULL DEFAULT 0,
    joined_at VARCHAR NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    manager_id VARCHAR REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS clients (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    description VARCHAR NOT NULL DEFAULT '',
    client_id VARCHAR REFERENCES clients (id),
    created_by VARCHAR NOT NULL REFERENCES users (id),
    created_at VARCHAR NOT NULL,
    background_image TEXT NOT NULL DEFAULT '',
    accent_color VARCHAR NOT NULL DEFAULT '',
    project_image TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS project_members (
    project_id VARCHAR NOT NULL REFERENCES projects (id),
    user_id VARCHAR NOT NULL REFERENCES users (id),
    PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS sections (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    project_id VARCHAR NOT NULL REFERENCES projects (id)
);

CREATE TABLE IF NOT EXISTS user_stories (
    id VARCHAR PRIMARY KEY,
    project_id VARCHAR NOT NULL REFERENCES projects (id),
    section_id VARCHAR REFERENCES sections (id),
    title VARCHAR NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    priority VARCHAR NOT NULL DEFAULT 'Medium',
    status VARCHAR NOT NULL DEFAULT 'backlog',
    assignee_id VARCHAR REFERENCES users (id),
    reporter_id VARCHAR NOT NULL REFERENCES users (id),
    estimated_hours VARCHAR,
    story_points VARCHAR,
    start_date VARCHAR,
    due_date VARCHAR,
    sprint VARCHAR NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    approved_by_manager BOOLEAN NOT NULL DEFAULT FALSE,
    -- A story may sit under another (epic -> story). NULL = top level.
    parent_story_id VARCHAR REFERENCES user_stories (id) ON DELETE SET NULL,
    created_at VARCHAR NOT NULL,
    updated_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS user_story_feedback (
    id VARCHAR PRIMARY KEY,
    user_story_id VARCHAR NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES users (id),
    message TEXT NOT NULL,
    created_at VARCHAR NOT NULL,
    updated_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS user_story_assignees (
    user_story_id VARCHAR NOT NULL REFERENCES user_stories (id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_story_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_story_attachments (
    id VARCHAR PRIMARY KEY,
    user_story_id VARCHAR NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
    filename VARCHAR NOT NULL,
    stored_name VARCHAR NOT NULL,
    content_type VARCHAR NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    uploaded_by VARCHAR NOT NULL REFERENCES users (id),
    created_at VARCHAR NOT NULL
);

-- Unified work items. `tasks` and `user_stories` are the same shape at two
-- altitudes, and the three join tables below existed twice, identical but for
-- the name of their foreign key. One row per piece of work, `type` saying which
-- kind, one `parent_id` for the whole tree (story->story, story->task,
-- task->task). Columns only one kind can hold stay nullable and are guarded in
-- logic: a story carries no tracked time, a task carries no story points.
--
-- Every task and story row lives here. The bootstrap splits on semicolons, so
-- comments in this file must not contain one.
CREATE TABLE IF NOT EXISTS work_items (
    id VARCHAR PRIMARY KEY,
    type VARCHAR NOT NULL,
    parent_id VARCHAR REFERENCES work_items (id) ON DELETE SET NULL,
    project_id VARCHAR NOT NULL REFERENCES projects (id),
    section_id VARCHAR REFERENCES sections (id),
    title VARCHAR NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority VARCHAR NOT NULL DEFAULT 'Medium',
    status VARCHAR NOT NULL DEFAULT 'backlog',
    due_date VARCHAR,
    sprint VARCHAR NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    estimated_hours VARCHAR,
    approved_by_manager BOOLEAN NOT NULL DEFAULT FALSE,
    created_by VARCHAR REFERENCES users (id),
    created_at VARCHAR NOT NULL,
    updated_at VARCHAR,
    assigned_to VARCHAR REFERENCES users (id),
    assigned_by VARCHAR REFERENCES users (id),
    is_started BOOLEAN NOT NULL DEFAULT FALSE,
    started_at VARCHAR,
    completed_at VARCHAR,
    time_tracked INTEGER NOT NULL DEFAULT 0,
    min_log_minutes INTEGER NOT NULL DEFAULT 1,
    custom_fields_json TEXT NOT NULL DEFAULT '{}',
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    story_points VARCHAR,
    start_date VARCHAR,
    CONSTRAINT ck_work_items_type CHECK (type IN ('story', 'task')),
    -- A story never accrues execution state. Enforced here and not only in
    -- logic: losing the two-table split loses the guarantee that a time log
    -- could not point at a story in the first place.
    CONSTRAINT ck_work_items_story_has_no_time CHECK (
        type <> 'story' OR (time_tracked = 0 AND is_started = FALSE AND started_at IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS work_item_assignees (
    work_item_id VARCHAR NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (work_item_id, user_id)
);

CREATE TABLE IF NOT EXISTS work_item_feedback (
    id VARCHAR PRIMARY KEY,
    work_item_id VARCHAR NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    message TEXT NOT NULL DEFAULT '',
    created_at VARCHAR NOT NULL,
    updated_at VARCHAR
);

CREATE TABLE IF NOT EXISTS work_item_attachments (
    id VARCHAR PRIMARY KEY,
    work_item_id VARCHAR NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
    filename VARCHAR NOT NULL,
    stored_name VARCHAR NOT NULL,
    content_type VARCHAR NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    uploaded_by VARCHAR REFERENCES users (id),
    created_at VARCHAR NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_work_items_project ON work_items (project_id);
CREATE INDEX IF NOT EXISTS ix_work_items_parent ON work_items (parent_id);
CREATE INDEX IF NOT EXISTS ix_work_items_type ON work_items (type);
CREATE INDEX IF NOT EXISTS ix_work_item_assignees_user ON work_item_assignees (user_id);
CREATE INDEX IF NOT EXISTS ix_work_item_feedback_item ON work_item_feedback (work_item_id);
CREATE INDEX IF NOT EXISTS ix_work_item_attachments_item ON work_item_attachments (work_item_id);

CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR PRIMARY KEY,
    title VARCHAR NOT NULL,
    description VARCHAR NOT NULL DEFAULT '',
    project_id VARCHAR NOT NULL REFERENCES projects (id),
    section_id VARCHAR NOT NULL REFERENCES sections (id),
    user_story_id VARCHAR REFERENCES user_stories (id) ON DELETE SET NULL,
    parent_task_id VARCHAR REFERENCES tasks (id) ON DELETE CASCADE,
    assigned_to VARCHAR NOT NULL REFERENCES users (id),
    assigned_by VARCHAR NOT NULL REFERENCES users (id),
    created_by VARCHAR NOT NULL REFERENCES users (id),
    due_date VARCHAR NOT NULL,
    sprint VARCHAR NOT NULL DEFAULT '',
    priority VARCHAR NOT NULL,
    status VARCHAR NOT NULL,
    is_started BOOLEAN NOT NULL DEFAULT FALSE,
    started_at VARCHAR,
    completed_at VARCHAR,
    approved_by_manager BOOLEAN NOT NULL DEFAULT FALSE,
    time_tracked INTEGER NOT NULL DEFAULT 0,
    min_log_minutes INTEGER NOT NULL DEFAULT 1,
    estimated_hours VARCHAR,
    tags_json TEXT NOT NULL DEFAULT '[]',
    custom_fields_json TEXT NOT NULL DEFAULT '{}',
    created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS task_assignees (
    task_id VARCHAR NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_timer_runs (
    user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    task_id VARCHAR NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
    started_at VARCHAR NOT NULL,
    PRIMARY KEY (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS task_time_logs (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES users (id),
    log_date VARCHAR NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_task_time_user_date UNIQUE (task_id, log_date, user_id)
);

CREATE TABLE IF NOT EXISTS kanban_columns (
    id VARCHAR PRIMARY KEY,
    label VARCHAR NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    -- Palette key from lib/column-colors, not a hex value.
    color VARCHAR NOT NULL DEFAULT 'slate'
);

CREATE TABLE IF NOT EXISTS timesheet_submissions (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    week_start VARCHAR NOT NULL,
    status VARCHAR NOT NULL,
    submitted_at VARCHAR NOT NULL,
    reviewer_id VARCHAR REFERENCES users (id) ON DELETE SET NULL,
    reviewed_at VARCHAR,
    rejection_note TEXT NOT NULL DEFAULT '',
    submitted_dates TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT uq_timesheet_submission_user_week UNIQUE (user_id, week_start)
);

CREATE TABLE IF NOT EXISTS skills (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS user_skills (
    user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    skill_id VARCHAR NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE IF NOT EXISTS task_skills (
    task_id VARCHAR NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
    skill_id VARCHAR NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, skill_id)
);

CREATE TABLE IF NOT EXISTS timesheet_entries (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users (id),
    work_date VARCHAR NOT NULL,
    project_id VARCHAR NOT NULL REFERENCES projects (id),
    section_id VARCHAR NOT NULL REFERENCES sections (id),
    description TEXT NOT NULL DEFAULT '',
    time_from VARCHAR NOT NULL,
    time_to VARCHAR NOT NULL,
    seconds INTEGER NOT NULL,
    billable BOOLEAN NOT NULL DEFAULT TRUE,
    -- Set when the row came from a task (timer stop, or the hours entered at
    -- Done), so those hours can be revised instead of duplicated.
    task_id VARCHAR REFERENCES work_items (id) ON DELETE SET NULL,
    created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS task_feedback (
    id VARCHAR PRIMARY KEY,
    task_id VARCHAR NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES users (id),
    message TEXT NOT NULL,
    created_at VARCHAR NOT NULL,
    updated_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS task_checklists (
    id VARCHAR PRIMARY KEY,
    task_id VARCHAR NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
    title VARCHAR NOT NULL,
    priority VARCHAR NOT NULL DEFAULT 'Medium',
    is_done BOOLEAN NOT NULL DEFAULT FALSE,
    position INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR NOT NULL REFERENCES users (id),
    created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS task_attachments (
    id VARCHAR PRIMARY KEY,
    task_id VARCHAR NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
    filename VARCHAR NOT NULL,
    stored_name VARCHAR NOT NULL,
    content_type VARCHAR NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    uploaded_by VARCHAR NOT NULL REFERENCES users (id),
    created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users (id),
    action VARCHAR NOT NULL,
    entity_type VARCHAR NOT NULL,
    entity_id VARCHAR NOT NULL,
    entity_name VARCHAR NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '{}',
    created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users (id),
    type VARCHAR NOT NULL,
    title VARCHAR NOT NULL DEFAULT '',
    message VARCHAR NOT NULL DEFAULT '',
    entity_type VARCHAR NOT NULL DEFAULT 'task',
    entity_id VARCHAR NOT NULL DEFAULT '',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    triggered_by VARCHAR NOT NULL REFERENCES users (id),
    created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id VARCHAR PRIMARY KEY,
    data TEXT NOT NULL,
    created_at VARCHAR NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS oauth_grants (
    key VARCHAR PRIMARY KEY,
    kind VARCHAR NOT NULL,
    client_id VARCHAR NOT NULL DEFAULT '',
    user_id VARCHAR NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    expires_at DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS personal_access_tokens (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name VARCHAR NOT NULL DEFAULT 'MCP token',
    token_hash VARCHAR NOT NULL UNIQUE,
    prefix VARCHAR NOT NULL DEFAULT '',
    created_at VARCHAR NOT NULL DEFAULT '',
    last_used_at VARCHAR,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at VARCHAR NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS scrums (
    id VARCHAR PRIMARY KEY,
    work_date VARCHAR NOT NULL,
    title VARCHAR NOT NULL DEFAULT 'Scrum',
    position INTEGER NOT NULL DEFAULT 0,
    raw_text TEXT NOT NULL DEFAULT '',
    parsed_json TEXT NOT NULL DEFAULT '',
    parse_status VARCHAR NOT NULL DEFAULT 'empty',
    updated_by VARCHAR REFERENCES users (id),
    updated_at VARCHAR NOT NULL DEFAULT '',
    created_at VARCHAR NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS teams_transcript_imports (
    transcript_id VARCHAR PRIMARY KEY,
    meeting_id VARCHAR NOT NULL DEFAULT '',
    scrum_id VARCHAR REFERENCES scrums (id) ON DELETE SET NULL,
    imported_by VARCHAR REFERENCES users (id),
    imported_at VARCHAR NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE INDEX IF NOT EXISTS ix_users_manager_id ON users (manager_id);
CREATE INDEX IF NOT EXISTS ix_tasks_project_id ON tasks (project_id);
CREATE INDEX IF NOT EXISTS ix_tasks_section_id ON tasks (section_id);
CREATE INDEX IF NOT EXISTS ix_tasks_assigned_to ON tasks (assigned_to);
CREATE INDEX IF NOT EXISTS ix_project_members_user_id ON project_members (user_id);
CREATE INDEX IF NOT EXISTS ix_task_time_logs_user_id ON task_time_logs (user_id);
CREATE INDEX IF NOT EXISTS ix_task_assignees_user_id ON task_assignees (user_id);
CREATE INDEX IF NOT EXISTS ix_sections_project_id ON sections (project_id);
CREATE INDEX IF NOT EXISTS ix_timesheet_entries_project_id ON timesheet_entries (project_id);
CREATE INDEX IF NOT EXISTS ix_timesheet_entries_user_id ON timesheet_entries (user_id);
CREATE INDEX IF NOT EXISTS ix_timesheet_entries_work_date ON timesheet_entries (work_date);
CREATE INDEX IF NOT EXISTS ix_timesheet_submissions_user_id ON timesheet_submissions (user_id);
CREATE INDEX IF NOT EXISTS ix_timesheet_submissions_week_start ON timesheet_submissions (week_start);
CREATE INDEX IF NOT EXISTS ix_timesheet_submissions_reviewer_id ON timesheet_submissions (reviewer_id);
CREATE INDEX IF NOT EXISTS ix_task_feedback_task_id ON task_feedback (task_id);
CREATE INDEX IF NOT EXISTS ix_task_checklists_task_id ON task_checklists (task_id);
CREATE INDEX IF NOT EXISTS ix_task_attachments_task_id ON task_attachments (task_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS ix_notifications_user_id ON notifications (user_id);
CREATE INDEX IF NOT EXISTS ix_personal_access_tokens_user_id ON personal_access_tokens (user_id);
CREATE INDEX IF NOT EXISTS ix_scrums_work_date ON scrums (work_date);

CREATE TABLE IF NOT EXISTS forecast_visibility (
    id VARCHAR PRIMARY KEY,
    entity_type VARCHAR NOT NULL,
    entity_id VARCHAR NOT NULL,
    user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    hidden_at VARCHAR,
    restored_at VARCHAR
);
CREATE INDEX IF NOT EXISTS ix_forecast_visibility_user_entity ON forecast_visibility (user_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS temp_tasks (
    id VARCHAR PRIMARY KEY,
    import_id VARCHAR NOT NULL,
    user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind VARCHAR NOT NULL,
    parent_id VARCHAR,
    title VARCHAR NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    project_id VARCHAR,
    section_id VARCHAR,
    priority VARCHAR NOT NULL DEFAULT 'Medium',
    position INTEGER NOT NULL DEFAULT 0,
    source_text TEXT NOT NULL DEFAULT '',
    assignee_ids TEXT NOT NULL DEFAULT '[]',
    extra_json TEXT NOT NULL DEFAULT '{}',
    created_at VARCHAR NOT NULL,
    updated_at VARCHAR NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_temp_tasks_user_id ON temp_tasks (user_id);
CREATE INDEX IF NOT EXISTS ix_temp_tasks_import_id ON temp_tasks (import_id);
CREATE INDEX IF NOT EXISTS ix_temp_tasks_parent_id ON temp_tasks (parent_id);
CREATE INDEX IF NOT EXISTS ix_user_stories_parent ON user_stories (parent_story_id);
CREATE INDEX IF NOT EXISTS ix_user_story_feedback_story ON user_story_feedback (user_story_id);
CREATE INDEX IF NOT EXISTS ix_timesheet_entries_task ON timesheet_entries (task_id);

-- The service connects as a least-privilege IAM role with no DDL rights, so it
-- can never create any of the above for itself. Grant it the data access it
-- needs, including on tables added later.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
