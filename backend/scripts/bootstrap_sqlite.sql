-- ZET SQLite schema bootstrap (idempotent). Used only when ZET_TEST_SQLITE=1.

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
    section_id VARCHAR NOT NULL REFERENCES sections (id),
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
    user_story_id VARCHAR NOT NULL REFERENCES user_stories (id) ON DELETE CASCADE,
    filename VARCHAR NOT NULL,
    stored_name VARCHAR NOT NULL,
    content_type VARCHAR NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    uploaded_by VARCHAR NOT NULL REFERENCES users (id),
    created_at VARCHAR NOT NULL
);

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
    priority VARCHAR NOT NULL,
    status VARCHAR NOT NULL,
    is_started BOOLEAN NOT NULL DEFAULT FALSE,
    started_at VARCHAR,
    completed_at VARCHAR,
    approved_by_manager BOOLEAN NOT NULL DEFAULT FALSE,
    time_tracked INTEGER NOT NULL DEFAULT 0,
    min_log_minutes INTEGER NOT NULL DEFAULT 1,
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
    task_id VARCHAR NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    started_at VARCHAR NOT NULL,
    PRIMARY KEY (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS task_time_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id VARCHAR NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES users (id),
    log_date VARCHAR NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_task_time_user_date UNIQUE (task_id, log_date, user_id)
);

CREATE TABLE IF NOT EXISTS kanban_columns (
    id VARCHAR PRIMARY KEY,
    label VARCHAR NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
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
    created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS task_feedback (
    id VARCHAR PRIMARY KEY,
    task_id VARCHAR NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES users (id),
    message TEXT NOT NULL,
    created_at VARCHAR NOT NULL,
    updated_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS task_checklists (
    id VARCHAR PRIMARY KEY,
    task_id VARCHAR NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    title VARCHAR NOT NULL,
    priority VARCHAR NOT NULL DEFAULT 'Medium',
    is_done BOOLEAN NOT NULL DEFAULT FALSE,
    position INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR NOT NULL REFERENCES users (id),
    created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS task_attachments (
    id VARCHAR PRIMARY KEY,
    task_id VARCHAR NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    filename VARCHAR NOT NULL,
    stored_name VARCHAR NOT NULL,
    content_type VARCHAR NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    uploaded_by VARCHAR NOT NULL REFERENCES users (id),
    created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id VARCHAR NOT NULL REFERENCES users (id),
    action VARCHAR NOT NULL,
    entity_type VARCHAR NOT NULL,
    entity_id VARCHAR NOT NULL,
    entity_name VARCHAR NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '{}',
    created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    expires_at REAL
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
