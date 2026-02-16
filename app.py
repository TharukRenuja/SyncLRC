from flask import Flask, request, jsonify, render_template
from db_manager import DatabaseManager
from lyrics_fetcher import LyricsFetcher
import os

# Set HOME to /tmp for Vercel read-only file system
os.environ['HOME'] = '/tmp'

app = Flask(__name__)


db_manager = DatabaseManager()
lyrics_fetcher = LyricsFetcher()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/lyrics', methods=['GET'])
def get_lyrics():
    track = request.args.get('track', '').strip(' "\'')
    artist = request.args.get('artist', '').strip(' "\'')
    requested_type = request.args.get('type')
    if requested_type:
        requested_type = requested_type.strip(' "\'')

    if not track or not artist:
        return jsonify({"error": "Missing 'track' or 'artist' parameter"}), 400

    cached_karaoke = db_manager.get_lyrics(track, artist, 'karaoke')
    if cached_karaoke:
        converted_lyrics, converted_type = lyrics_fetcher.convert_lyrics(cached_karaoke['lyrics'], 'karaoke', requested_type)
        return jsonify({
            "lyrics": converted_lyrics,
            "type": converted_type
        })

    cached_backup = db_manager.get_lyrics(track, artist, 'synced')
    if not cached_backup:
        cached_backup = db_manager.get_lyrics(track, artist, 'plain')
    
    if cached_backup:
        converted_lyrics, converted_type = lyrics_fetcher.convert_lyrics(cached_backup['lyrics'], cached_backup['type'], requested_type)
        return jsonify({
            "lyrics": converted_lyrics,
            "type": converted_type
        })

    fetched_lyrics, fetched_type = lyrics_fetcher.get_lyrics(track, artist, None)

    if not fetched_lyrics:
        return jsonify({"error": "Lyrics not found"}), 404

    data_to_save = {
        "name": track,
        "artist": artist,
        "type": fetched_type,
        "lyrics": fetched_lyrics
    }
    db_manager.save_lyrics(data_to_save)
    
    converted_lyrics, converted_type = lyrics_fetcher.convert_lyrics(fetched_lyrics, fetched_type, requested_type)
    
    return jsonify({
        "lyrics": converted_lyrics,
        "type": converted_type
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
