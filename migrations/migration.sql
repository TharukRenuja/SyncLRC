-- Bring the D1 cache schema up to the current transient-lyrics identity model.
--
-- This file is safe for a fresh D1 database and for databases that already have the
-- current tracks columns but have not yet recorded this migration. SQLite/D1 cannot
-- add a column only when missing, so older six-column databases should first apply the
-- legacy column-add migration from the release that introduced D1 lyric caching.

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

-- Name -> id index, replacing the per-request KV lookup.
CREATE INDEX IF NOT EXISTS names ON tracks(name, artist);

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

INSERT INTO track_ids (id, name, artist, duration, first_seen)
SELECT id, name, artist, duration, COALESCE(fetched_at, 0)
FROM (
  SELECT t.*,
         ROW_NUMBER() OVER (
           PARTITION BY norm
           ORDER BY (karaoke IS NOT NULL AND synced IS NOT NULL AND plain IS NOT NULL) DESC,
                    (synced IS NOT NULL AND plain IS NOT NULL) DESC,
                    (karaoke IS NOT NULL OR synced IS NOT NULL OR plain IS NOT NULL) DESC,
                    id
         ) AS rank
  FROM tracks t
  WHERE norm IS NOT NULL AND norm <> ''
)
WHERE rank = 1
ON CONFLICT(id) DO NOTHING;

INSERT OR IGNORE INTO track_keys (key, track_id)
SELECT norm, id FROM tracks
WHERE norm IS NOT NULL AND norm <> '';

CREATE TABLE IF NOT EXISTS flags (
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, kind)
);

INSERT OR REPLACE INTO flags (key, kind, expires_at)
SELECT norm, kind, expires_at FROM cache_flags;

DROP INDEX IF EXISTS idx_tracks_id;
DROP INDEX IF EXISTS idx_tracks_norm;
DROP INDEX IF EXISTS idx_tracks_name_artist;

-- Move durable identity into the new metadata table. Lyrics themselves are
-- copied to R2 lazily when requested; old `tracks` rows remain a compatibility
-- cache and continue to be purged by the daily job during the transition.
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

CREATE TABLE IF NOT EXISTS keys (
  key TEXT PRIMARY KEY,
  lyric_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS lyric ON keys(lyric_id);

INSERT OR IGNORE INTO lyrics (id, isrc, name, artist, album, duration, instrumental, karaoke, synced, plain)
SELECT ids.id, ids.isrc, COALESCE(tracks.name, ids.name), COALESCE(tracks.artist, ids.artist),
       tracks.album, COALESCE(tracks.duration, ids.duration),
       COALESCE(tracks.instrumental, 0),
       CASE WHEN tracks.karaoke IS NOT NULL AND tracks.karaoke <> '' THEN 1 ELSE 0 END,
       CASE WHEN tracks.synced IS NOT NULL AND tracks.synced <> '' THEN 1 ELSE 0 END,
       CASE WHEN tracks.plain IS NOT NULL AND tracks.plain <> '' THEN 1 ELSE 0 END
FROM track_ids AS ids LEFT JOIN tracks ON tracks.id = ids.id;

INSERT OR IGNORE INTO lyrics (id, name, artist, album, duration, instrumental, karaoke, synced, plain)
SELECT id, name, artist, album, duration, instrumental,
       CASE WHEN karaoke IS NOT NULL AND karaoke <> '' THEN 1 ELSE 0 END,
       CASE WHEN synced IS NOT NULL AND synced <> '' THEN 1 ELSE 0 END,
       CASE WHEN plain IS NOT NULL AND plain <> '' THEN 1 ELSE 0 END
FROM tracks;

INSERT OR IGNORE INTO keys (key, lyric_id)
SELECT key, track_id FROM track_keys;

INSERT OR IGNORE INTO keys (key, lyric_id)
SELECT norm, id FROM tracks WHERE norm IS NOT NULL AND norm <> '';

-- The legacy track_ids index has the same global SQLite name. Move it to the
-- new metadata table, preserving the unique-ISRC invariant.
DROP INDEX IF EXISTS isrc;
CREATE UNIQUE INDEX IF NOT EXISTS isrc ON lyrics(isrc) WHERE isrc IS NOT NULL;
CREATE INDEX IF NOT EXISTS lyrics_names ON lyrics(name, artist);

CREATE TABLE IF NOT EXISTS stats (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER
);
