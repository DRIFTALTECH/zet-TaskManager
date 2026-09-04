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

-- Grants. A new table is created with no privileges for anyone but its owner,
-- and ALTER DEFAULT PRIVILEGES only covers tables created AFTER it was set, by
-- the role that set it. So work_items and its children came out unreadable to
-- the service, which fails every request with:
--     permission denied for table work_items
--
-- Change app_user below if the service connects as a different role (it is the
-- DB_USER in backend/.env).
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON work_items            TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON work_item_assignees   TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON work_item_feedback    TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON work_item_attachments TO app_user;

-- Belt and braces: catch anything else added since the last bootstrap, and make
-- future tables grant themselves.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- Confirm the columns landed. This should list every column added above.
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'work_items' ORDER BY column_name;
--
-- Confirm the grants landed. This should return four rows.
-- SELECT table_name, privilege_type FROM information_schema.role_table_grants
--  WHERE grantee = 'app_user' AND table_name LIKE 'work_item%' AND privilege_type = 'SELECT';
