from flask import Flask, request, jsonify, render_template
from db_manager import DatabaseManager
from lyrics_fetcher import LyricsFetcher
import os

os.environ['HOME'] = '/tmp'

app = Flask(__name__)


db_manager = DatabaseManager()
lyrics_fetcher = LyricsFetcher()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/lyrics', methods=['GET'])
def get_lyrics():
    lyrics_id = request.args.get('id', '').strip(' "\'')
    track = request.args.get('track', '').strip(' "\'')
    artist = request.args.get('artist', '').strip(' "\'')
    requested_type = request.args.get('type')
    if requested_type:
        requested_type = requested_type.strip(' "\'')

    # Fetch by ID
    if lyrics_id:
        cached_data = db_manager.get_lyrics_by_id(lyrics_id)
        if cached_data:
            converted_lyrics, converted_type = lyrics_fetcher.convert_lyrics(cached_data['lyrics'], cached_data['type'], requested_type)
            return jsonify({
                "lyrics": converted_lyrics,
                "type": converted_type,
                "id": cached_data.get('id'),
                "track": cached_data.get('name'),
                "artist": cached_data.get('artist')
            })
        return jsonify({"error": "Lyrics with provided ID not found"}), 404

    # Fetch by Track/Artist
    if not track or not artist:
        return jsonify({"error": "Missing 'track' and 'artist' parameters (or 'id')"}), 400

    cached_karaoke = db_manager.get_lyrics(track, artist, 'karaoke')
    if cached_karaoke:
        converted_lyrics, converted_type = lyrics_fetcher.convert_lyrics(cached_karaoke['lyrics'], 'karaoke', requested_type)
        return jsonify({
            "lyrics": converted_lyrics,
            "type": converted_type,
            "id": cached_karaoke.get('id') or db_manager._generate_hash(track, artist, 'karaoke'),
            "track": cached_karaoke.get('name') or track,
            "artist": cached_karaoke.get('artist') or artist
        })

    cached_backup = db_manager.get_lyrics(track, artist, 'synced')
    if not cached_backup:
        cached_backup = db_manager.get_lyrics(track, artist, 'plain')
    
    if cached_backup:
        converted_lyrics, converted_type = lyrics_fetcher.convert_lyrics(cached_backup['lyrics'], cached_backup['type'], requested_type)
        return jsonify({
            "lyrics": converted_lyrics,
            "type": converted_type,
            "id": cached_backup.get('id') or db_manager._generate_hash(track, artist, cached_backup['type']),
            "track": cached_backup.get('name') or track,
            "artist": cached_backup.get('artist') or artist
        })

    fetched_lyrics, fetched_type = lyrics_fetcher.get_lyrics(track, artist, None)

    if not fetched_lyrics:
        return jsonify({"error": "Lyrics not found"}), 404

    generated_id = db_manager._generate_hash(track, artist, fetched_type)

    data_to_save = {
        "name": track,
        "artist": artist,
        "type": fetched_type,
        "lyrics": fetched_lyrics,
        "id": generated_id
    }
    db_manager.save_lyrics(data_to_save)
    
    converted_lyrics, converted_type = lyrics_fetcher.convert_lyrics(fetched_lyrics, fetched_type, requested_type)
    
    return jsonify({
        "lyrics": converted_lyrics,
        "type": converted_type,
        "id": generated_id,
        "track": track,
        "artist": artist
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
