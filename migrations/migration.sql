-- One-time cleanup for the already-migrated production schema.
-- Apply before deploying code that reads the metadata attempt column.
-- Fresh installations use src/schema.sql instead.

-- Durable metadata; lyric bodies live in R2 and are purged daily.
CREATE TABLE IF NOT EXISTS lyrics (
  id TEXT PRIMARY KEY,
  isrc TEXT,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  duration INTEGER,
  instrumental INTEGER NOT NULL DEFAULT 0,
  karaoke INTEGER NOT NULL DEFAULT 0,
  synced INTEGER NOT NULL DEFAULT 0,
  plain INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS isrc ON lyrics(isrc) WHERE isrc IS NOT NULL;
CREATE INDEX IF NOT EXISTS lyrics_names ON lyrics(name, artist);

CREATE TABLE IF NOT EXISTS keys (
  key TEXT PRIMARY KEY,
  lyric_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS lyric ON keys(lyric_id);

CREATE TABLE IF NOT EXISTS flags (
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, kind)
);

CREATE TABLE IF NOT EXISTS stats (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER
);
ALTER TABLE stats RENAME COLUMN updated_at TO updated;

-- Current OSS databases already have lyrics/keys and the four old tables.
-- Preserve remaining identities directly, without intermediate tables.
-- Any lyric text still unique to tracks must be copied to R2 before this migration.
INSERT OR IGNORE INTO lyrics (id, isrc, name, artist, duration)
SELECT id, isrc, name, artist, duration FROM track_ids;

INSERT OR IGNORE INTO lyrics (id, name, artist, album, duration, instrumental)
SELECT id, name, artist, album, duration, instrumental FROM tracks;

INSERT OR IGNORE INTO keys (key, lyric_id)
SELECT key, track_id FROM track_keys;

INSERT OR IGNORE INTO keys (key, lyric_id)
SELECT norm, id FROM tracks WHERE norm IS NOT NULL AND norm <> '';

INSERT OR IGNORE INTO flags (key, kind, expires_at)
SELECT norm, kind, expires_at FROM cache_flags;

DROP TABLE IF EXISTS track_keys;
DROP TABLE IF EXISTS track_ids;
DROP TABLE IF EXISTS tracks;
DROP TABLE IF EXISTS cache_flags;

-- Existing metadata rows have not attempted background enrichment yet.
ALTER TABLE lyrics ADD COLUMN metadata INTEGER NOT NULL DEFAULT 0;
