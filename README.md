# SyncLRC 🎵

SyncLRC is a simple, minimalist lyrics finder designed to help you discover and export lyrics in multiple formats. Whether you need word-by-word Karaoke lyrics, time-synced LRC files, or simple plain text, SyncLRC has you covered.

## ✨ Features

- **Triple Format Support**: Fetch lyrics in Karaoke (Enhanced LRC), Synced (Standard LRC), and Plain Text formats.
- **Smart Fallback**: If your preferred format isn't available, the app gracefully lets you know and suggests alternatives.
- **Clean Sanitization**: Automatically filters out metadata and credit clutter (lyricists, composers, etc.) for a distraction-free experience.
- **Developer API**: Built-in `/lyrics` endpoint for programmatic access to lyrics data.
- **Web Access**: General users can easily search for tracks and view all lyrics formats directly through the intuitive web interface.

## 🚀 Getting Started

### Prerequisites

- Python 3.8+
- A Supabase account (for lyrics caching/database)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/TharukRenuja/SyncLRC.git
   cd SyncLRC
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory and add your Supabase credentials:
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_anon_key
   ```

### Running the App

```bash
python app.py
```
The application will be available at `http://127.0.0.1:5000`.

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

This project uses [syncedlyrics](https://github.com/moehmeni/syncedlyrics) for fetching lyrics from multiple sources.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
Built with ❤️ by [Tharuk Renuja](https://github.com/TharukRenuja)
