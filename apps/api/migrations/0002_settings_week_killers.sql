-- Settings gain evening_hour and week_killers (SPEC 11.5, DECISIONS D17). Columns follow apps/api/src/columns.ts.
-- Existing rows take the schema defaults. evening_hour NULL means "off", so its column default is 19, not NULL.
ALTER TABLE settings ADD COLUMN evening_hour INTEGER DEFAULT 19;
ALTER TABLE settings ADD COLUMN week_killers TEXT NOT NULL DEFAULT '["work_peaks","travel","evenings"]';
