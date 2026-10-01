CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  duration INTEGER,
  instrumental INTEGER NOT NULL DEFAULT 0,
  karaoke TEXT,
  synced TEXT,
  plain TEXT,
  karaoke_ok INTEGER NOT NULL DEFAULT 0,
  synced_ok INTEGER NOT NULL DEFAULT 0,
  plain_ok INTEGER NOT NULL DEFAULT 0,
  norm TEXT,
  fetched_at INTEGER
);

CREATE INDEX IF NOT EXISTS names ON tracks(name, artist);

-- Canonical identity, kept forever. The retention purge drops `tracks`, so without this
-- the only record of a track's id and folded key would go with it. Carries no lyric text,
-- which is what makes it affordable to keep: ~194 bytes against ~12KB of lyrics.
CREATE TABLE IF NOT EXISTS track_ids (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  duration INTEGER,
  isrc TEXT,
  first_seen INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS isrc ON track_ids(isrc) WHERE isrc IS NOT NULL;

CREATE TABLE IF NOT EXISTS track_keys (
  key TEXT PRIMARY KEY,
  track_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS track ON track_keys(track_id);

-- Ephemeral per-track flags (kind: 'neg' | 'cooldown') with an explicit expiry.
CREATE TABLE IF NOT EXISTS flags (
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, kind)
);
