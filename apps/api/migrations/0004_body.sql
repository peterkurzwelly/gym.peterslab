-- Body and fuel (docs/ENGINE_RULES.md section 10): the body_log sync table and the body settings.
-- Columns follow apps/api/src/columns.ts; test/schema.test.ts checks them against @gym/schema.
-- Apply this migration before deploying a Worker that knows body_log: sync reads every table in SYNC_TABLES.

-- One row per local date, id "bd_YYYY-MM-DD". Every value is optional (NULL = not logged).
CREATE TABLE body_log (
  id TEXT NOT NULL PRIMARY KEY,
  date TEXT NOT NULL,
  weight_kg REAL,
  waist_cm REAL,
  steps INTEGER,
  protein_g REAL,
  kcal REAL,
  sleep_h REAL,
  note TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX body_log_rev ON body_log (rev);

-- Settings gain the profile, the goal and the hand set targets. Existing rows take the schema defaults:
-- no profile yet (NULL), desk job, cut at 0.5% of body weight a week, 8000 steps.
ALTER TABLE settings ADD COLUMN sex TEXT;
ALTER TABLE settings ADD COLUMN birth_year INTEGER;
ALTER TABLE settings ADD COLUMN height_cm REAL;
ALTER TABLE settings ADD COLUMN job_activity TEXT NOT NULL DEFAULT 'desk';
ALTER TABLE settings ADD COLUMN goal TEXT NOT NULL DEFAULT 'cut';
ALTER TABLE settings ADD COLUMN cut_rate_pct REAL NOT NULL DEFAULT 0.5;
ALTER TABLE settings ADD COLUMN goal_weight_kg REAL;
ALTER TABLE settings ADD COLUMN kcal_override REAL;
ALTER TABLE settings ADD COLUMN protein_override_g REAL;
ALTER TABLE settings ADD COLUMN steps_target INTEGER NOT NULL DEFAULT 8000;
