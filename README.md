# SyncLRC

SyncLRC is a simple, minimalist lyrics finder designed to help you discover and export lyrics in multiple formats. Whether you need word-by-word Karaoke lyrics, time-synced LRC files, or simple plain text, SyncLRC has you covered.

## Features

- **Triple Format Support**: Fetch lyrics in Karaoke (Enhanced LRC), Synced (Standard LRC), and Plain Text formats.
- **Clean Sanitization**: Automatically filters out metadata and credit clutter (lyricists, composers, etc.) for a distraction-free experience.
- **Self-Healing Cache**: Missing karaoke tracks are automatically re-fetched daily so popular songs gradually upgrade to word-level synced lyrics.
- **Developer API**: Built-in `/api/search` and `/api/lyrics` endpoints for programmatic access.
- **Web Access**: General users can easily search for tracks and view all lyrics formats directly through the intuitive web interface.

## Developer API

All API endpoints are under `/api/`.

### Endpoints

#### 1. Search Tracks & Lyrics
`GET /api/search?q={query}&limit={limit}&offset={offset}`

**Parameters:**
- `q`: (Required) Search term (track or artist name).
- `limit`: (Optional) Max results (default `10`).
- `offset`: (Optional) Pagination offset (default `0`).

**Response:**
```json
{
  "results": [
    {
      "id": "a1b2c3d4e5f6g7h8...",
      "track": "Song Name",
      "artist": "Artist Name",
      "lyrics": {
        "plain": "Lyrics text...",
        "synced": "[00:00.00]...",
        "karaoke": "[00:00.00]<00:00.05>..."
      }
    }
  ]
}
```

#### 2. Fetch Specific Lyrics

**Fetch by ID (path)**
`GET /api/lyrics/{id}`

Lookup a track directly by its internal SyncLRC ID. No query parameters needed.

**Fetch by Track & Artist (query params)**
`GET /api/lyrics?track={track}&artist={artist}&type={type}&album={album}&duration={duration}`

- `track`: (Required) Song name.
- `artist`: (Required) Artist name.
- `type`: (Optional) `karaoke`, `synced`, or `plain`.
- `album`: (Optional) Album name for more accurate matching.
- `duration`: (Optional) Track duration in seconds for more accurate matching.

```json
{
  "id": "abc123...",
  "track": "Song Name",
  "artist": "Artist Name",
  "album": "Album Name",
  "duration": 215,
  "instrumental": false,
  "karaoke": "[00:00.00]<00:00.05>...",
  "synced": "[00:00.00]...",
  "plain": "Lyrics text..."
}
```

## Contributing

Contributions are welcome!

1.  **Improvements**: Feel free to open an issue or pull request.
2.  **Sanitization**: We maintain a list of strings to filter out (like "Synced by", "Translated by"). If you find more clutter in lyrics, please add them to the sanitization list in `src/sanitize.py`.

## Credits

This project uses the [iTunes Search API](https://performance-partners.apple.com/search-api) to fetch track metadata, [LRCLIB](https://lrclib.net) as the primary lyrics source, and [LDDC](https://github.com/akashrchandran/LDDC) + [syncedlyrics](https://github.com/moehmeni/syncedlyrics) for fetching lyrics from `Netease`, `QQ Music`, `Kugou`, and `Musixmatch`.

---
Built with ❤️ by [Tharuk Renuja](https://github.com/TharukRenuja)
