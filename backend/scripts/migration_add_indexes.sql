-- Migration to add optimized composite indexes for task and timesheet queries.

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_due_date 
    ON tasks (assigned_to, due_date DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id_status 
    ON tasks (project_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_section_id_assigned_to_created 
    ON tasks (section_id, assigned_to, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_user_date 
    ON timesheet_entries (user_id, work_date);
