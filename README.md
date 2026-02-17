# SyncLRC 🎵

SyncLRC is a simple, minimalist lyrics finder designed to help you discover and export lyrics in multiple formats. Whether you need word-by-word Karaoke lyrics, time-synced LRC files, or simple plain text, SyncLRC has you covered.

## ✨ Features

- **Triple Format Support**: Fetch lyrics in Karaoke (Enhanced LRC), Synced (Standard LRC), and Plain Text formats.
- **Smart Fallback**: If your preferred format isn't available, the app gracefully lets you know and suggests alternatives.
- **Enhanced Provider Selection**: Prioritizes top-tier sources like Musixmatch and LRCLIB to ensure high-quality, synchronized lyrics.
- **Original Language Preference**: Intelligent language detection ensures the original lyrics are prioritized over translations, especially for international tracks.
- **Clean Sanitization**: Automatically filters out metadata and credit clutter (lyricists, composers, etc.) for a distraction-free experience.
- **Developer API**: Built-in `/lyrics` endpoint for programmatic access to lyrics data.
- **Web Access**: General users can easily search for tracks and view all lyrics formats directly through the intuitive web interface.

## 🛠️ Developer API

Devs can fetch lyrics directly via the following endpoint:

`GET /lyrics?track="Song Name"&artist="Artist Name"&type=synced`

**Parameters:**
- `track`: (Required) Song name.
- `artist`: (Required) Artist name.
- `type`: (Optional) `karaoke`, `synced`, or `plain`.

## 🤝 Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request if you have ideas for improvements.

## 📜 Credits

This project uses [syncedlyrics](https://github.com/moehmeni/syncedlyrics) for fetching lyrics from `Musixmatch`, `LRCLIB`, and `Netease`.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
Built with ❤️ by [Tharuk Renuja](https://github.com/TharukRenuja)
