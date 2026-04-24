> **🚧 Service Temporarily Paused** <br/>
SyncLRC is currently paused due to excessive usage exhausting the free Vercel hosting quota. I'm also on an exam break and unable to maintain or migrate to a VPS at the moment. Sorry for the inconvenience. I'll be back after exams..!

# SyncLRC

SyncLRC is a simple, minimalist lyrics finder designed to help you discover and export lyrics in multiple formats. Whether you need word-by-word Karaoke lyrics, time-synced LRC files, or simple plain text, SyncLRC has you covered.

## Features

- **Triple Format Support**: Fetch lyrics in Karaoke (Enhanced LRC), Synced (Standard LRC), and Plain Text formats.
- **Smart Fallback**: If your preferred format isn't available, the app gracefully lets you know and suggests alternatives.
- **Enhanced Provider Selection**: Prioritizes top-tier sources like Musixmatch and LRCLIB to ensure high-quality, synchronized lyrics.
- **Original Language Preference**: Intelligent language detection ensures the original lyrics are prioritized over translations, especially for international tracks.
- **Clean Sanitization**: Automatically filters out metadata and credit clutter (lyricists, composers, etc.) for a distraction-free experience.
- **Developer API**: Built-in `/search` `/lyrics` endpoints for programmatic access to lyrics data.
- **Web Access**: General users can easily search for tracks and view all lyrics formats directly through the intuitive web interface.

## TODO

### Security & Rate Limiting
- [ ] Switch to Redis-backed rate limiting
- [ ] Per-API-key limits instead of just IP
- [ ] Block known VPN/datacenter ranges that abuse free APIs
- [ ] Detect burst abuse
- [ ] Penalize repeat 429 offenders with escalating cooldowns
- [ ] Hard daily quota with a proper lockout (not silent drops)

### Monitoring
- [ ] Basic usage dashboard (top IPs, popular tracks, traffic over time)
- [ ] Spike alerts for unexpected traffic (scraping / DDoS early warning)
- [ ] Per-provider response time tracking to catch slow upstreams

### Lyrics Quality
- [ ] Extended timestamp sanitization:
  - Strip malformed or negative timestamps (e.g. `[-00:01.00]`)
  - Normalize inconsistent timestamp formats (`[0:1.5]` → `[00:01.50]`)
  - Remove duplicate lines with identical timestamps
  - Drop lines where timestamp exceeds track duration
  - Handle out-of-order timestamps (sort or discard)
- [ ] Expand sanitization list (filter more credit/metadata clutter patterns)
- [ ] Language confidence scoring (improve original vs. translation detection for edge cases)
- [ ] Log which provider actually served each result (useful for debugging fallbacks)

### API & Routing
- [ ] Move to proper `/api/` route structure (`/api/search`, `/api/lyrics`)
- [ ] Versioned endpoints (`/api/v1/`)
- [ ] Consistent error response format across all endpoints `{ error, code, message }`
- [ ] Proper HTTP status codes everywhere (currently some errors return 200)
- [ ] OpenAPI/Swagger spec

## Developer API

Devs can fetch lyrics directly via the following endpoint:

### Endpoints

#### 1. Search Tracks & Lyrics
`GET` `/search?query={query}&limit={limit}&offset={offset}`

**Parameters:**
- `query`: (Required) Search term (track or artist).
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
  ],
  "total": 10,
  "limit": 25,
  "offset": 0
}
```

#### 2. Fetch Specific Lyrics
`GET` `/lyrics?track={track}&artist={artist}&type={type}`
`GET` `/lyrics?id={id}`

**Parameters:**
- `id`: (Optional) Unique hash to fetch specific lyrics (bypasses track/artist).
- `track`: (Required if no `id`) Song name.
- `artist`: (Required if no `id`) Artist name.
- `type`: (Optional) `karaoke`, `synced`, or `plain`.

**Response:**
```json
{
  "id": "a1b2c3d4e5f6g7h8...",
  "track": "Song Name",
  "artist": "Artist Name",
  "lyrics": "[00:00.00]...",
  "type": "synced"
}
```

### Rate Limits

To ensure fair usage and stability, the API has the following rate limits:

- **Search (`/search`)**: 60 requests per minute (~1 req/sec).
- **Lyrics (`/lyrics`)**: 300 requests per minute (~5 req/sec).
- **Global**: 2,000 requests per day (per IP).

Exceeding these limits will result in a `429 Too Many Requests` response.

> **Note**: These limits may be increased in the future as our databases grow or if we can host SyncLRC on a real server. If you'd like to support this or donate, please connect with [Tharuk](https://github.com/TharukRenuja) (check social links on profile) or donate at [tharuk.pro/donate](https://tharuk.pro/donate).

## Contributing

Contributions are welcome!

1.  **Improvements**: Feel free to open an issue or pull request.
2.  **Sanitization**: We maintain a list of strings to filter out (like "Synced by", "Translated by"). If you find more clutter in lyrics, please add them to the sanitization list in `sanitize.py`.

## Credits

This project uses the [iTunes Search API](https://performance-partners.apple.com/search-api) to fetch track metadata and [syncedlyrics](https://github.com/moehmeni/syncedlyrics) for fetching lyrics from `Musixmatch`, `LRCLIB`, and `Netease`.

---
Built with ❤️ by [Tharuk Renuja](https://github.com/TharukRenuja)
