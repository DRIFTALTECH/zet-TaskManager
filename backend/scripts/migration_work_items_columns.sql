-- Bring an existing work_items table up to the current model.
--
-- Run as the OWNER (postgres), not the app's IAM role: the service connects
-- with no DDL rights, so it logs these as skipped and carries on booting.
--
--     psql "$DATABASE_URL" -f scripts/migration_work_items_columns.sql
--
-- Needed because CREATE TABLE IF NOT EXISTS is a no-op once the table exists,
-- so any column added after work_items first shipped never arrives on its own.
-- The symptom is a read failing with:
--     column w.assigned_to does not exist

ALTER TABLE work_items ADD COLUMN IF NOT EXISTS assigned_to VARCHAR REFERENCES users (id);
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS assigned_by VARCHAR REFERENCES users (id);
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS story_points VARCHAR;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS start_date VARCHAR;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS updated_at VARCHAR;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT NOT NULL DEFAULT '';

-- Confirm: this should list every column above.
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'work_items' ORDER BY column_name;
