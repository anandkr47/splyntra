-- Soft-archive support for projects. Archived projects are hidden from the
-- active selector but keep their data (reversible). Hard delete is a separate,
-- explicit action that purges Postgres (via FK cascade) and ClickHouse rows.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_projects_org_active
  ON projects(org_id) WHERE archived_at IS NULL;
