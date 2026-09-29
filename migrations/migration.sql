-- Brings a pre-D1-only database up to the current schema.
--
-- src/schema.sql is the source of truth and is what a fresh install uses. This file
-- exists only for databases created from an earlier version of this project, whose
-- `tracks` table had six columns and no lyrics storage:
--
--   id, name, artist, album, duration, instrumental
--
-- Everything below brings that forward to match src/schema.sql exactly. Existing rows
-- keep their metadata and are refilled on demand: they start with NULL lyrics and 0
-- format flags, which the read path treats as "not stored yet".

ALTER TABLE tracks ADD COLUMN karaoke TEXT;
ALTER TABLE tracks ADD COLUMN synced TEXT;
ALTER TABLE tracks ADD COLUMN plain TEXT;
ALTER TABLE tracks ADD COLUMN karaoke_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN synced_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN plain_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN norm TEXT;

-- Retention timestamp, so the daily purge can drop lyrics held longer than the window.
ALTER TABLE tracks ADD COLUMN fetched_at INTEGER;

-- Name -> id index, replacing the per-request KV lookup.
CREATE INDEX IF NOT EXISTS idx_tracks_norm ON tracks(norm);
CREATE INDEX IF NOT EXISTS idx_tracks_name_artist ON tracks(name, artist);

-- Negative cache and upstream cooldowns, replacing the KV keys.
CREATE TABLE IF NOT EXISTS cache_flags (
  norm TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (norm, kind)
);

-- Existing rows get a full retention window from upgrade time rather than being purged
-- on the first cron run, since they were fetched recently enough.
UPDATE tracks SET fetched_at = (strftime('%s', 'now') * 1000) WHERE fetched_at IS NULL;
