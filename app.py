from flask import Flask, request, jsonify, render_template
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from db_manager import DatabaseManager
from lyrics_fetcher import LyricsFetcher
import os
import requests
import concurrent.futures

os.environ['HOME'] = '/tmp'

app = Flask(__name__)

# Initialize Rate Limiter
# Global default: 2000 per day (Fallback for safety)
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["2000 per day"],
    storage_uri="memory://"
)


db_manager = DatabaseManager()
lyrics_fetcher = LyricsFetcher()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/search', methods=['GET'])
@limiter.limit("60 per minute") # 1 request per second
def search_tracks():
    query = request.args.get('query', '').strip(' "\'')
    limit = request.args.get('limit', '10').strip(' "\'')
    offset = request.args.get('offset', '0').strip(' "\'')

    if not query:
        return jsonify({"error": "Missing 'query' parameter"}), 400

    try:
        itunes_url = f"https://itunes.apple.com/search?term={query}&media=music&entity=song&limit={limit}&offset={offset}"
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"}
        itunes_resp = requests.get(itunes_url, headers=headers)
        itunes_resp.raise_for_status()
        itunes_data = itunes_resp.json()

        itunes_results = itunes_data.get('results', [])
        
        def process_track(item):
            track_name = item.get('trackName')
            artist_name = item.get('artistName')
            
            if not track_name or not artist_name:
                return None

            cached_data = db_manager.get_lyrics(track_name, artist_name, None)
            
            if cached_data:
                raw_lyrics = cached_data['lyrics']
                found_type = cached_data['type']
                lyrics_id = cached_data.get('id') or db_manager._generate_hash(track_name, artist_name, found_type)
            else:
                raw_lyrics, found_type = lyrics_fetcher.get_lyrics(track_name, artist_name, None)
                if raw_lyrics:
                    lyrics_id = db_manager._generate_hash(track_name, artist_name, found_type)
                    db_manager.save_lyrics({
                        "name": track_name,
                        "artist": artist_name,
                        "type": found_type,
                        "lyrics": raw_lyrics,
                        "id": lyrics_id
                    })
                else:
                    return None

            plain_lyrics, _ = lyrics_fetcher.convert_lyrics(raw_lyrics, found_type, 'plain')
            synced_lyrics, _ = lyrics_fetcher.convert_lyrics(raw_lyrics, found_type, 'synced')
            karaoke_lyrics, _ = lyrics_fetcher.convert_lyrics(raw_lyrics, found_type, 'karaoke')
            
            lyrics_obj = {
                "plain": plain_lyrics,
                "synced": synced_lyrics if found_type in ['synced', 'karaoke'] else None,
                "karaoke": karaoke_lyrics if found_type == 'karaoke' else None
            }

            return {
                "id": lyrics_id,
                "track": track_name,
                "artist": artist_name,
                "album": item.get('collectionName'),
                "lyrics": lyrics_obj
            }

        # ThreadPoolExecutor
        final_results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            future_to_index = {executor.submit(process_track, item): i for i, item in enumerate(itunes_results)}
            
            # Temporary storage to sort later
            ordered_results = [None] * len(itunes_results)
            
            for future in concurrent.futures.as_completed(future_to_index):
                index = future_to_index[future]
                try:
                    res = future.result()
                    ordered_results[index] = res
                except Exception as e:
                    print(f"Error processing track at index {index}: {e}")
                    ordered_results[index] = None

        # Filter out tracks without lyrics
        final_results = [r for r in ordered_results if r is not None]

        return jsonify({
            "results": final_results,
            "total": len(final_results),
            "limit": int(limit),
            "offset": int(offset)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/lyrics', methods=['GET'])
@limiter.limit("300 per minute") # 5 requests per second
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
