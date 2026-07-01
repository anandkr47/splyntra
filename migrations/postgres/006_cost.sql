-- Externalized model price table + per-project budgets.
-- Prices live in the DB (editable via the admin API, hot-reloaded by the
-- collector) instead of a hardcoded Go map, so pricing updates need no redeploy.

CREATE TABLE IF NOT EXISTS model_prices (
    model              VARCHAR(128) PRIMARY KEY,
    prompt_per_1k      DOUBLE PRECISION NOT NULL,
    completion_per_1k  DOUBLE PRECISION NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with the built-in defaults (matches the collector's fallback table).
INSERT INTO model_prices (model, prompt_per_1k, completion_per_1k) VALUES
    ('gpt-4',             0.03,    0.06),
    ('gpt-4-turbo',       0.01,    0.03),
    ('gpt-4o',            0.005,   0.015),
    ('gpt-4o-mini',       0.00015, 0.0006),
    ('gpt-3.5-turbo',     0.0005,  0.0015),
    ('claude-3-opus',     0.015,   0.075),
    ('claude-3-sonnet',   0.003,   0.015),
    ('claude-3-haiku',    0.00025, 0.00125),
    ('claude-3.5-sonnet', 0.003,   0.015),
    ('claude-4-sonnet',   0.003,   0.015),
    ('claude-4-opus',     0.015,   0.075),
    ('gemini-1.5-pro',    0.0035,  0.0105),
    ('gemini-1.5-flash',  0.000075,0.0003),
    ('command-r-plus',    0.003,   0.015),
    ('mistral-large',     0.004,   0.012),
    ('mistral-small',     0.001,   0.003)
ON CONFLICT (model) DO NOTHING;

-- Per-project (or org-wide when project_id is NULL) monthly spend budget in USD.
CREATE TABLE IF NOT EXISTS budgets (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id        UUID REFERENCES projects(id) ON DELETE CASCADE,
    monthly_limit_usd DOUBLE PRECISION NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One budget per (org, project) — NULL project_id is the org-wide budget.
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_org_project
    ON budgets(org_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
