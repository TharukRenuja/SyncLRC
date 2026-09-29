-- Move lyrics storage into D1.
--
-- src/schema.sql only creates a fresh table, so an existing deployment needs this to add
-- the new columns. Existing rows keep their metadata and are refilled on demand: they
-- start with NULL lyrics and 0 format flags, which the read path treats as "not stored
-- yet" and repopulates from LRCLib and the upstream on the next request.

ALTER TABLE tracks ADD COLUMN karaoke TEXT;
ALTER TABLE tracks ADD COLUMN synced TEXT;
ALTER TABLE tracks ADD COLUMN plain TEXT;
ALTER TABLE tracks ADD COLUMN karaoke_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN synced_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN plain_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN norm TEXT;

-- Name -> id index, replacing the per-request KV lookup.
CREATE INDEX IF NOT EXISTS idx_tracks_norm ON tracks(norm);

-- Negative cache and upstream cooldowns, replacing the KV keys.
CREATE TABLE IF NOT EXISTS cache_flags (
  norm TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (norm, kind)
);
