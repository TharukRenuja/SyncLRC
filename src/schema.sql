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

CREATE INDEX IF NOT EXISTS idx_tracks_name_artist ON tracks(name, artist);
CREATE INDEX IF NOT EXISTS idx_tracks_norm ON tracks(norm);

-- Ephemeral per-track flags (kind: 'neg' | 'cooldown') with an explicit expiry.
CREATE TABLE IF NOT EXISTS cache_flags (
  norm TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (norm, kind)
);
