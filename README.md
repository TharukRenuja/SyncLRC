<picture>
  <source media="(max-width: 600px)" srcset="https://i.ibb.co/SXfGQPLw/339631bdecf2.png" width="120">
  <img src="https://i.ibb.co/SXfGQPLw/339631bdecf2.png" align="right" width="250" alt="SyncLRC">
</picture>

# SyncLRC

SyncLRC is a **simple, minimalist lyrics finder** designed to help you **discover and export lyrics** in multiple formats. Whether you need word-by-word **(Karaoke)** lyrics, time-synced **(Synced)** LRC files, or simple text **(Plain)**, SyncLRC has you covered.

<a href="https://github.com/TharukRenuja/SyncLRC/releases/latest"><img src="https://img.shields.io/github/v/release/TharukRenuja/SyncLRC?label=Release&style=for-the-badge&color=E53935" alt="Release"></a> <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPLv3-FFD700.svg?style=for-the-badge" alt="AGPLv3"></a> <img src="https://img.shields.io/badge/Powered%20by%20Cloudflare-F38020?style=for-the-badge&logo=Cloudflare&logoColor=white" alt="Cloudflare">

## Features

- **Triple Format Support**: Fetch lyrics in Karaoke (Enhanced LRC), Synced (Standard LRC), and Plain Text formats.
- **Clean Sanitization**: Automatically filters out metadata and credit clutter (lyricists, composers, etc.) for a distraction-free experience.
- **Developer API**: Built-in `/search` and `/lyrics` endpoints for programmatic access.
- **Web Access**: Try it at **[synclrc.dev](https://synclrc.dev)**

---

## Developer API

#### 1. Search Tracks & Lyrics

`GET /search?q={query}&limit={limit}&offset={offset}`

<details>
<summary><b>Parameters & Response</b></summary>

**Parameters:**
- `q`: (Required) Search term (track or artist name).
- `limit`: (Optional) Integer from `1` to `50` (default `10`).
- `offset`: (Optional) Integer from `0` to `1000` (default `0`).

**Response:**
```json
{
  "results": [
    {
      "id": "a1b2c3d4e5f6g7h8...",
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

**Fetch by ID (path)**

`GET /lyrics/{id}?type={type}`

**Fetch by Track & Artist (query params)**

`GET /lyrics?track={track}&artist={artist}&type={type}&album={album}&duration={duration}`

For collaborations, repeat `artist` once per artist. Order does not matter; any one of
them is enough to match.

`GET /lyrics?track={track}&artist={artist1}&artist={artist2}`

<details>
<summary><b>Parameters & Response</b></summary>

- `track`: (Required) Song name.
- `artist`: (Required) Artist name. Repeat for collaborations.
- `type`: (Optional) `karaoke`, `synced`, or `plain`.
- `album`: (Optional) Album name for more accurate matching.
- `duration`: (Optional) Track duration in seconds for more accurate matching.
- `format`: (Optional) `lrc` or `ttml`. Defaults to LRC.
- `include`: (Optional) Comma-separated `agents` and/or `background`. Requires `type=karaoke`.

**Response:**
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

**Optional Formats & Vocal Features:**

`GET /lyrics?track={track}&artist={artist}&format=lrc&include=agents,background`

`GET /lyrics/{id}?format=ttml&include=agents,background`

Use these options with either endpoint. Omit them for the default response.
For LRC, read `{agent:v1}` as the vocal agent ID and parenthesized lines as background
vocals. TTML carries these roles in its XML.

**Response with Optional Features:**

```json
{
  "id": "abc123...",
  "track": "Song Name",
  "artist": ["Artist Name"],
  "album": "Album Name",
  "duration": 215,
  "instrumental": false,
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

- `requested`: Features requested by the caller.
- `included`: Features present in the returned lyrics.
- `unavailable`: Requested features absent from the checked results.
- `unknown`: Requested features that could not be verified because a source failed or timed out.

`artist` is always an array, including solo tracks. Agent IDs distinguish vocal
parts; they do not identify credited artists.

**Error Responses:**

- `400`: Invalid `format`, `include`, or incompatible `type`.
- `404`: No matching lyrics, or an existing cached miss.
- `503`: Lyrics sources temporarily unavailable and no usable fallback.
- `504`: Upstream search timed out and no usable fallback.

</details>

---

## Contributing

Contributions are welcome!

1.  **Improvements**: Feel free to open an [issue](https://github.com/TharukRenuja/SyncLRC/issues) or [pull request](https://github.com/TharukRenuja/SyncLRC/pulls).
2.  **Sanitization**: We maintain a list of strings to filter out (like "Synced by", "Translated by"). If you find more clutter in lyrics, please add them to the sanitization list in `src/sanitize.js`.

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
transient legacy D1 rows that have not been requested in the last 24 hours. Durable D1
metadata and lookup keys remain so an expired lyric id can be rebuilt on demand.

Track metadata and lookup keys live in D1; lyric bodies live in R2 and are expired daily.
This avoids storing large lyric payloads in the permanent metadata table. When you
self-host, both resources are yours to manage.

The SyncLRC source code is licensed under AGPL-3.0. That license applies to the software
itself and does not grant rights to third-party copyrighted content retrieved through the
software.

---

## Self-Hosting

The Worker needs two bindings: **D1** for metadata/lookup keys and **R2** for lyric bodies.
Create the R2 bucket named in `wrangler.jsonc` (the example uses `synclyrics-oss`).

1. Copy `wrangler.example.jsonc` to `wrangler.jsonc` and set your `database_id`, `UPSTREAM_URL`, and `UPSTREAM_SECRET`.
2. Create the R2 bucket:

   ```bash
   npx wrangler r2 bucket create synclyrics-oss
   ```

3. Create the schema:

   ```bash
   npx wrangler d1 execute <database_name> --remote --file=src/schema.sql
   ```

4. Deploy:

   ```bash
   npx wrangler deploy
   ```

Already running an older version (<`v1.1.2`) ? `src/schema.sql` only creates a fresh database, so
bring an existing one forward instead:

```bash
npx wrangler d1 execute <database_name> --remote --file=migrations/migration.sql
```

---

## Credits

This project uses the [iTunes Search API](https://performance-partners.apple.com/search-api) to fetch track metadata, [LRCLIB](https://lrclib.net) as the primary lyrics source, and [LDDC](https://github.com/chenmozhijin/LDDC) + [syncedlyrics](https://github.com/moehmeni/syncedlyrics) for fetching lyrics from `Netease`, `QQ Music`, `Kugou`, `Apple Music`, `Spotify` and `Musixmatch`.
