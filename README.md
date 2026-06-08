<img src="https://i.ibb.co/SXfGQPLw/339631bdecf2.png" align="right" width="250" alt="SyncLRC">

# SyncLRC

SyncLRC is a **simple, minimalist lyrics finder** designed to help you **discover and export lyrics** in multiple formats. Whether you need word-by-word **(Karaoke)** lyrics, time-synced **(Synced)** LRC files, or simple text **(Plain)**, SyncLRC has you covered.

<a href="https://github.com/TharukRenuja/SyncLRC/releases/latest"><img src="https://img.shields.io/github/v/release/TharukRenuja/SyncLRC?label=Release&style=for-the-badge&color=E53935" alt="Release"></a> <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPLv3-FFD700.svg?style=for-the-badge" alt="AGPLv3"></a> <img src="https://img.shields.io/badge/Powered%20by%20Cloudflare-F38020?style=for-the-badge&logo=Cloudflare&logoColor=white" alt="Cloudflare">

## Features

- **Triple Format Support**: Fetch lyrics in Karaoke (Enhanced LRC), Synced (Standard LRC), and Plain Text formats.
- **Clean Sanitization**: Automatically filters out metadata and credit clutter (lyricists, composers, etc.) for a distraction-free experience.
- **Developer API**: Built-in `/search` and `/lyrics` endpoints for programmatic access.
- **Web Access**: Try it at **[synclrc.dev](https://synclrc.dev)**

## Developer API

### Endpoints

#### 1. Search Tracks & Lyrics
`GET /search?q={query}&limit={limit}&offset={offset}`

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

`GET /lyrics/{id}?type={type}`

- `type`: (Optional) `karaoke`, `synced`, or `plain`.

**Fetch by Track & Artist (query params)**

`GET /lyrics?track={track}&artist={artist}&type={type}&album={album}&duration={duration}`

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

1.  **Improvements**: Feel free to open an [issue](https://github.com/TharukRenuja/SyncLRC/issues) or [pull request](https://github.com/TharukRenuja/SyncLRC/pulls).
2.  **Sanitization**: We maintain a list of strings to filter out (like "Synced by", "Translated by"). If you find more clutter in lyrics, please add them to the sanitization list in `src/sanitize.js`.

## Legal Disclaimer

SyncLRC acts as an easy gateway for developers, as there is no open and free word-by-word (karaoke-style) synced lyrics provider available. SyncLRC does not permanently store or host copyrighted lyrics. All lyric content is fetched on-demand from third-party sources and returned directly to the requesting client. A short-lived transient cache exists solely to reduce redundant outbound API calls and is automatically evicted.

## Credits

This project uses the [iTunes Search API](https://performance-partners.apple.com/search-api) to fetch track metadata, [LRCLIB](https://lrclib.net) as the primary lyrics source, and [LDDC](https://github.com/chenmozhijin/LDDC) + [syncedlyrics](https://github.com/moehmeni/syncedlyrics) for fetching lyrics from `Netease`, `QQ Music`, `Kugou`, and `Musixmatch`.

---
Built with ❤️ by [Tharuk Renuja](https://github.com/TharukRenuja)
