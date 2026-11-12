-- Body and fuel, follow-up (docs/ENGINE_RULES.md section 10, docs/DECISIONS.md D30).
-- A changed goal or pace must not re-judge the weeks that were lived under the old one:
-- body_adjust_since is the local date of the change, body_adjust_base_kcal the correction carried over.
-- Existing rows: no change recorded (NULL) and nothing carried over (0).
ALTER TABLE settings ADD COLUMN body_adjust_since TEXT;
ALTER TABLE settings ADD COLUMN body_adjust_base_kcal INTEGER NOT NULL DEFAULT 0;
