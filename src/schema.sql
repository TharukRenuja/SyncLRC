CREATE TABLE IF NOT EXISTS lyrics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  karaoke INTEGER NOT NULL DEFAULT 0,
  synced INTEGER NOT NULL DEFAULT 0,
  plain INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lyrics_name_artist ON lyrics(name, artist);
CREATE INDEX IF NOT EXISTS idx_lyrics_id ON lyrics(id);
