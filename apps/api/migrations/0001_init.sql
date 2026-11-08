-- Workout OS · initial D1 schema.
-- One table per sync table in packages/schema (SYNC_TABLES). Column names match the Zod fields exactly.
-- Arrays/objects/records are JSON TEXT, booleans INTEGER 0/1, nullable fields NULL.
-- rev: global, monotonically increasing change number (sync cursor). Unique across all tables.
-- test/schema.test.ts asserts every Zod field has a matching column.

CREATE TABLE sync_meta (
  key TEXT NOT NULL PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO sync_meta (key, value) VALUES ('rev', 0);

CREATE TABLE settings (
  id TEXT NOT NULL PRIMARY KEY,
  block_start_date TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  timezone TEXT NOT NULL,
  limitations TEXT NOT NULL,
  remembered_weights TEXT NOT NULL,
  interval_modality TEXT NOT NULL,
  session_order TEXT NOT NULL,
  block_swaps TEXT NOT NULL,
  rest_overrides TEXT NOT NULL,
  increment_overrides TEXT NOT NULL,
  start_pct REAL NOT NULL,
  sound INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX settings_rev ON settings (rev);

CREATE TABLE exercise (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  primary_muscles TEXT NOT NULL,
  secondary_muscles TEXT NOT NULL,
  equipment TEXT NOT NULL,
  fatigue_rating INTEGER NOT NULL,
  increment_kg REAL NOT NULL,
  step_kg REAL NOT NULL,
  default_rest_s INTEGER NOT NULL,
  tags TEXT NOT NULL,
  measure TEXT NOT NULL,
  per_hand INTEGER NOT NULL,
  bodyweight INTEGER NOT NULL,
  instructions TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  custom INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX exercise_rev ON exercise (rev);

CREATE TABLE training_week (
  id TEXT NOT NULL PRIMARY KEY,
  start_date TEXT NOT NULL,
  repaired INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX training_week_rev ON training_week (rev);

CREATE TABLE session (
  id TEXT NOT NULL PRIMARY KEY,
  program_day_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  mode TEXT NOT NULL,
  flags TEXT NOT NULL,
  swaps TEXT NOT NULL,
  notes TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX session_rev ON session (rev);

CREATE TABLE set_log (
  id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  prescription_id TEXT,
  set_index INTEGER NOT NULL,
  target_weight REAL,
  target_reps INTEGER,
  target_rir INTEGER,
  weight REAL NOT NULL,
  reps INTEGER NOT NULL,
  rir INTEGER,
  is_warmup INTEGER NOT NULL,
  is_top_set INTEGER NOT NULL,
  pain_flag INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX set_log_rev ON set_log (rev);

CREATE TABLE cardio_log (
  id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT,
  date TEXT NOT NULL,
  modality TEXT NOT NULL,
  minutes REAL NOT NULL,
  hard_minutes REAL,
  intensity TEXT NOT NULL,
  avg_hr INTEGER,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX cardio_log_rev ON cardio_log (rev);

CREATE TABLE checkin (
  id TEXT NOT NULL PRIMARY KEY,
  date TEXT NOT NULL,
  sleep INTEGER NOT NULL,
  soreness INTEGER NOT NULL,
  stress INTEGER NOT NULL,
  energy INTEGER NOT NULL,
  hrv REAL,
  rhr REAL,
  sleep_hours REAL,
  hrv_type TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX checkin_rev ON checkin (rev);

CREATE TABLE decision (
  id TEXT NOT NULL PRIMARY KEY,
  date TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  session_id TEXT,
  exercise_id TEXT,
  inputs_snapshot TEXT NOT NULL,
  output TEXT NOT NULL,
  explanation TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX decision_rev ON decision (rev);
