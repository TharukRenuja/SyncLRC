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
CREATE INDEX IF NOT EXISTS names ON lyrics(name, artist);

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
