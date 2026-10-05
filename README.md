<picture>
  <source media="(max-width: 600px)" srcset="https://i.ibb.co/SXfGQPLw/339631bdecf2.png" width="120">
  <img src="https://i.ibb.co/SXfGQPLw/339631bdecf2.png" align="right" width="250" alt="SyncLRC">
</picture>

# SyncLRC

SyncLRC is a **simple, minimalist lyrics finder** for discovering and exporting word-by-word **(Karaoke)** lyrics, time-synced **(Synced)** LRC files, or simple text **(Plain)**.

<a href="https://github.com/TharukRenuja/SyncLRC/releases/latest"><img src="https://img.shields.io/github/v/release/TharukRenuja/SyncLRC?label=Release&style=for-the-badge&color=E53935" alt="Release"></a> <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPLv3-FFD700.svg?style=for-the-badge" alt="AGPLv3"></a> <img src="https://img.shields.io/badge/Powered%20by%20Cloudflare-F38020?style=for-the-badge&logo=Cloudflare&logoColor=white" alt="Cloudflare">

## Features

- **Lyric Formats**: Karaoke (Enhanced LRC), Synced (Standard LRC), and Plain Text.
- **Optional Vocal Features**: Vocal agents and background vocals in LRC or TTML.
- **Clean Sanitization**: Automatically filters out metadata and credit clutter (lyricists, composers, etc.) for a distraction-free experience.
- **Developer API**: `/search` and `/lyrics` endpoints.
- **Web Access**: Try it at **[synclrc.dev](https://synclrc.dev)**.

---

## Developer API

#### 1. Search Tracks & Lyrics

`GET /search?q={query}&limit={limit}&offset={offset}`

<details>
<summary><b>Parameters & Response</b></summary>

**Parameters:**

- `q`: (Required) Track or artist name.
- `limit`: (Optional) `1`–`50`, default `10`.
- `offset`: (Optional) `0`–`1000`, default `0`.

**Response:**

```json
{
  "results": [
    {
      "id": "abc123...",
      "track": "Song Name",
      "artist": ["Artist Name"],
      "lyrics": {
        "plain": "Lyrics text...",
        "synced": "[00:00.00]...",
        "karaoke": "[00:00.00]<00:00.05>..."
      }
    }
  ]
}
```

</details>

#### 2. Fetch Specific Lyrics

**Fetch by ID**

`GET /lyrics/{id}?type={type}`

**Fetch by Track & Artist**

`GET /lyrics?track={track}&artist={artist}&type={type}`

For collaborations, repeat `artist` for each artist:

`GET /lyrics?track={track}&artist={artist1}&artist={artist2}`

<details>
<summary><b>Parameters & Response</b></summary>

- `track`: (Required for track/artist requests) Song name.
- `artist`: (Required for track/artist requests) Artist name; repeat for collaborations.
- `type`: (Optional) `karaoke`, `synced`, or `plain`.
- `album`: (Optional, track/artist requests) Album name to improve matching.
- `duration`: (Optional, track/artist requests) Track duration in seconds to improve matching.
- `format`: (Optional) `lrc` or `ttml`.
- `include`: (Optional) Comma-separated `agents` and/or `background`. Use with `type=karaoke` or omit `type`.

Omit `type`, `format`, and `include` for the default response below. Missing lyric
variants are `null`. `artist` is always an array, including solo tracks.

**Default Response:**

```json
{
  "id": "abc123...",
  "track": "Song Name",
  "artist": ["Artist Name"],
  "album": "Album Name",
  "duration": 215,
  "instrumental": false,
  "karaoke": "[00:00.00]<00:00.05>...",
  "synced": "[00:00.00]...",
  "plain": "Lyrics text..."
}
```

**Request a Lyric Type:**

`GET /lyrics/{id}?type=karaoke`

If the requested type is unavailable, the API returns the best available lyrics.
Check the returned `type` before displaying them.

```json
{
  "id": "abc123...",
  "track": "Song Name",
  "artist": ["Artist Name"],
  "album": "Album Name",
  "duration": 215,
  "instrumental": false,
  "lyrics": "[00:00.00]Hello",
  "type": "synced"
}
```

**Optional Formats & Vocal Features:**

`GET /lyrics?track={track}&artist={artist}&format=lrc&include=agents,background`

`GET /lyrics/{id}?format=ttml&include=agents,background`

Both options work with either endpoint. In LRC, `{agent:v1}` identifies a vocal
part and parenthesized lines mark background vocals. TTML carries these roles in
its XML. Your player must support them. Agent IDs do not identify credited artists.

The response keeps the track metadata and returns these lyric fields:

```json
{
  "lyrics": "[00:00.00]{agent:v1}<00:00.05>Hello",
  "type": "karaoke",
  "format": "lrc",
  "features": {
    "requested": ["agents", "background"],
    "included": ["agents"],
    "unavailable": ["background"],
    "unknown": []
  }
}
```

- `requested`: Features you asked for.
- `included`: Features present in the returned lyrics.
- `unavailable`: Features absent from the checked results.
- `unknown`: Features that could not be verified.

`features` is returned when `include` is provided. Formatting or feature requests
still return fallback lyrics when karaoke is unavailable; check `type` and `features`.

**Error Responses:**

- `400`: Missing required parameters or invalid options.
- `404`: No matching lyrics or ID found.
- `503`: Sources temporarily unavailable, with no usable fallback.
- `504`: Upstream search timed out, with no usable fallback.

For `503` or `504`, retry with backoff and respect `Retry-After`.

</details>

---

## Contributing

Contributions are welcome!

1.  **Improvements**: Feel free to open an [issue](https://github.com/TharukRenuja/SyncLRC/issues) or [pull request](https://github.com/TharukRenuja/SyncLRC/pulls).
2.  **Sanitization**: We maintain a list of strings to filter out (like "Synced by", "Translated by"). If you find more clutter in lyrics, please add them to the sanitization list in `src/lyrics/sanitize.js`.


---

## Community Mirrors

The official SyncLRC API is served at `api.synclrc.dev`. Requests to that host are
answered by SyncLRC infrastructure.

SyncLRC may also be reached through independent community mirrors. A community mirror
is a separate deployment operated by its own owner, and it is not part of SyncLRC
infrastructure. Community mirrors may differ from the official API in caching,
availability, rate limits, and other usage policies.

If you operate a mirror backed by the SyncLRC upstream, please publish it as a general
community mirror rather than restricting it to a single application. Mirrors are
responsible for their own caching decisions and for their own legal and compliance
obligations. If a mirror is presented to users, it should identify itself as
independently operated so it is not mistaken for official SyncLRC infrastructure.

---

## Legal Disclaimer

SyncLRC makes word-by-word synced lyrics easy to consume. Most alternatives make you
sign up for an API key, ship a per-client agent that polls for updates, or build your own
translation and lyrics pipeline. SyncLRC is a plain HTTP endpoint that returns the format
you ask for.

All lyric content is fetched on-demand from third-party sources. The project does not
claim ownership of third-party lyrics, which remain the property of their respective
owners.

Lyrics are cached for one day, not archived. A daily cron deletes R2 lyric objects and
transient legacy D1 rows older than 24 hours. Durable D1 metadata and lookup keys
remain so an expired lyric id can be rebuilt on demand.

Track metadata and lookup keys live in D1; lyric bodies live in R2 and are expired daily.
This avoids storing large lyric payloads in the permanent metadata table. When you
self-host, both resources are yours to manage.

The SyncLRC source code is licensed under AGPL-3.0. That license applies to the software
itself and does not grant rights to third-party copyrighted content retrieved through the
software.

---

## Self-Hosting

You need a Cloudflare Worker, a D1 database, an R2 bucket, and access to a compatible
upstream lyrics API. Lyric bodies are cached for one day; track metadata is retained.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create the database and bucket:

   ```bash
   npx wrangler d1 create synclrc-d1
   npx wrangler r2 bucket create synclrc-r2
   ```

3. Copy `wrangler.example.jsonc` to `wrangler.jsonc`. Set your `database_id`,
   `UPSTREAM_URL`, and `UPSTREAM_SECRET`; match the database and bucket names above.

4. Create the schema:

   ```bash
   npx wrangler d1 execute synclrc-d1 --remote --file=src/schema.sql
   ```

5. Deploy:

   ```bash
   npx wrangler deploy
   ```

Upgrading an existing database from before `v1.1.2`? Use the migration in place of
the fresh schema:

```bash
npx wrangler d1 execute synclrc-d1 --remote --file=migrations/migration.sql
```

---

## Credits

This project uses the [iTunes Search API](https://performance-partners.apple.com/search-api) for web search metadata, [Deezer](https://developers.deezer.com) for API track metadata, and [LRCLIB](https://lrclib.net), [LDDC](https://github.com/chenmozhijin/LDDC), [BiniLyrics](https://lyrics.binimum.org), [BetterLyrics](https://github.com/jayfunc/BetterLyrics), and [amll-ttml-db](https://github.com/amll-dev/amll-ttml-db) for fetching lyrics from `Netease`, `QQ Music`, `Kugou`, `Apple Music`, `Spotify` and `Musixmatch`.