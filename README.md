<picture>
  <source media="(max-width: 600px)" srcset="https://i.ibb.co/SXfGQPLw/339631bdecf2.png" width="120">
  <img src="https://i.ibb.co/SXfGQPLw/339631bdecf2.png" align="right" width="250" alt="SyncLRC">
</picture>

# SyncLRC

SyncLRC is a **simple, minimalist lyrics finder** for discovering and exporting word-by-word **(Karaoke)** lyrics, time-synced **(Synced)** LRC files, or simple text **(Plain)**.

<a href="https://github.com/TharukRenuja/SyncLRC/releases/latest"><img src="https://img.shields.io/github/v/release/TharukRenuja/SyncLRC?label=Release&style=for-the-badge&color=E53935" alt="Release"></a> <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPLv3-FFD700.svg?style=for-the-badge" alt="AGPLv3"></a> <img src="https://img.shields.io/badge/Powered%20by%20Cloudflare-F38020?style=for-the-badge&logo=Cloudflare&logoColor=white" alt="Cloudflare">

## Features

- **Lyrics**: Word-timed `karaoke`, `synced` LRC and `plain` text.
- **Vocal Features**: `agents` and `background` vocals for karaoke and synced lyrics.
- **Formats**: `LRC` and `TTML` output.
- **Clean Output**: filters `metadata` and `credit` clutter.
- **Developer API**: Search and fetch lyrics by `track` or `ID`.
- **Web**: Find and export lyrics at **[synclrc.dev](https://synclrc.dev)**.

---

## Developer API

### 1. Fetch Lyrics

**By track and artist**

`GET /lyrics?track={track}&artist={artist}`

**By ID**

`GET /lyrics/{id}`

<details>
<summary><b>Parameters & Response</b></summary>

- `track`, `artist`: Required for track/artist requests. Repeat `artist` for collaborations.
- `type`: (Optional) `karaoke`, `synced`, or `plain`.
- `album`, `duration`: Optional matching hints for track/artist requests; duration is in seconds.
- `format`: (Optional) `lrc` or `ttml`.
- `include`: (Optional) `agents`, `bg`, or `agents,bg` for karaoke and synced lyrics. `bg` is an alias for `background`.

**Default Response:**

```json
{
  "id": "abc123...",
  "track": "Song Name",
  "artist": "Artist Name",
  "album": "Album Name",
  "duration": 215,
  "instrumental": false,
  "karaoke": "[00:01.00]<00:01.00>Hello",
  "synced": "[00:01.00]Hello",
  "plain": "Hello"
}
```

Missing variants are `null`. Requesting `type`, `format` or `include` returns a single `lyrics` field with its actual `type`. If the requested type is unavailable, available fallback lyrics are returned.

**Formats & Vocal Features:**

`GET /lyrics?track={track}&artist={artist}&type=synced&include=agents,bg`

`GET /lyrics/{id}?format=ttml&include=agents,bg`

```json
{
  "id": "abc123...",
  "track": "Song Name",
  "artist": "Artist Name",
  "album": "Album Name",
  "duration": 215,
  "instrumental": false,
  "lyrics": "[00:01.00]{agent:v1}Hello",
  "type": "synced",
  "format": "lrc",
  "features": {
    "requested": ["agents", "background"],
    "included": ["agents"],
    "unavailable": ["background"],
    "unknown": []
  }
}
```

`features` appears when `include` is provided. Check `type` and feature availability
before displaying lyrics. `unknown` means availability could not be verified.

LRC uses `{agent:v1}` for vocal parts and `{bg}` for background lines, requiring a compatible player. Agent IDs do not identify artists. Background lines have their own timestamps and may overlap lead vocals; ordinary parentheses do not mark a background line. TTML carries vocal roles in XML.

**Errors:**

- `400`: Missing parameters or invalid options.
- `404`: No matching lyrics or ID.
- `500`: Unexpected server error.
- `503`: Sources unavailable, with no usable fallback.
- `504`: Source timeout, with no usable fallback.

For `503` or `504`, retry with backoff and respect `Retry-After`.

</details>

### 2. Search

`GET /search?q={query}&limit={limit}&offset={offset}`

<details>
<summary><b>Parameters & Response</b></summary>

- `q`: Required track or artist name.
- `limit`: (Optional) `1`–`50`; default `10`.
- `offset`: (Optional) `0`–`1000`; default `0`.

```json
{
  "results": [
    {
      "id": "abc123...",
      "track": "Song Name",
      "artist": "Artist Name",
      "lyrics": {
        "karaoke": "[00:01.00]<00:01.00>Hello",
        "synced": "[00:01.00]Hello",
        "plain": "Hello"
      }
    }
  ]
}
```

</details>

---

## Contributing

Contributions are welcome through [issues](https://github.com/TharukRenuja/SyncLRC/issues) and [pull requests](https://github.com/TharukRenuja/SyncLRC/pulls).

- Report bugs with the request URL, expected behavior and actual result.
- Suggest features or improvements through an issue.
- For lyric cleanup improvements, update [sanitize.js](src/lyrics/sanitize.js).

---

## Community Mirrors

Community mirrors are independently hosted SyncLRC APIs. Their availability, limits and caching policies may differ from the official API at `api.synclrc.dev`.

Mirrors may serve the wider community, clearly state who operates them and disclose their usage policies. Each operator manages their own infrastructure and is responsible for following applicable laws and source terms.

---

## Legal Disclaimer

SyncLRC fetches lyrics on demand from third-party sources and does not claim ownership of that content. Lyrics remain the property of their respective copyright holders. SyncLRC is an independent project and is not affiliated with or endorsed by those sources.

Lyric bodies are cached temporarily in R2 rather than permanently archived. A daily cleanup removes objects older than 24 hours and expired flags; objects may remain until the next cleanup. D1 retains track metadata and lookup keys so lyrics can be fetched again on demand.

Self-hosters and community mirror operators are responsible for their deployments, caching policies and compliance with applicable laws and source terms. Access through SyncLRC does not grant permission to redistribute lyrics.

The source code is licensed under AGPL-3.0. This license applies to the software, not to third-party lyrics, and does not replace applicable content rights or attribution requirements.

---

## Self-Hosting

Deploy your own SyncLRC API with a Cloudflare Worker, D1 database, R2 bucket and compatible upstream lyrics API.

Get an upstream token from [@wbwlrcbot](https://t.me/wbwlrcbot) for **30 free uncached requests per day**. Cached requests are free and available without a token at [api.wbwlrc.workers.dev](https://api.wbwlrc.workers.dev/). Public community mirrors can request a mirror plan with up to **1,000 free uncached requests per day**. Supporter plans offer higher limits. Your support helps keep SyncLRC free for everyone and gives back to its sources through donations.

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

For an existing database with the legacy tables, use the one-time migration in place of the fresh schema. It also adds the `metadata` column required by the current API. Do not rerun it on an already-migrated database:

```bash
npx wrangler d1 execute synclrc-d1 --remote --file=migrations/migration.sql
```

---

## Credits

- [LRCLIB](https://lrclib.net), the original inspiration, main lyrics source and reference for match validation.
- [Deezer](https://developers.deezer.com), for track metadata.
- [iTunes Search API](https://performance-partners.apple.com/search-api), for web search and early metadata validation.
- [syncedlyrics](https://github.com/moehmeni/syncedlyrics), the foundation of the original Python version.
- [LDDC](https://github.com/chenmozhijin/LDDC), for parsing and format reference.
- [BiniLyrics](https://lyrics.binimum.org), [BetterLyrics](https://github.com/jayfunc/BetterLyrics) and [amll-ttml-db](https://github.com/amll-dev/amll-ttml-db), for word-timed lyric inspiration.
- [Metrolist](https://github.com/MetrolistGroup/Metrolist), for discovering and testing vocal features, and my daily streaming client.
