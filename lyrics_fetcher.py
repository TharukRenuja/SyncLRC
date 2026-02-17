import re
import time
import random
import syncedlyrics
from langdetect import detect, DetectorFactory
from langdetect.lang_detect_exception import LangDetectException
from sanitize import FORBIDDEN_KEYWORDS, LRC_TAGS

DetectorFactory.seed = 0

class LyricsFetcher:
    def get_lyrics(self, track: str, artist: str, requested_type: str = None):
        """
        Fetches lyrics and processes them based on the requested type.
        Priority: Karaoke (Enhanced) -> Synced -> Plain
        """
        if self.is_instrumental(track):
            return None, None

        search_term = f"{track} {artist}"
        
        expected_lang = self._detect_language(f"{track} {artist}")
        is_latin_metadata = self._is_mostly_latin(track) and self._is_mostly_latin(artist)
        
        providers = ["musixmatch", "lrclib", "netease"]
        results = []

        for provider in providers:
            raw_lyrics = None
            for attempt in range(2):
                try:
                    raw_lyrics = syncedlyrics.search(search_term, enhanced=True, providers=[provider])
                    if not raw_lyrics:
                        raw_lyrics = syncedlyrics.search(search_term, enhanced=False, providers=[provider])
                    
                    if raw_lyrics:
                        break
                    else:
                        break
                except Exception as e:
                    err_msg = str(e).lower()
                    if "401" in err_msg or "ssl" in err_msg or "eof" in err_msg:
                        if attempt == 0:
                            time.sleep(random.uniform(0.2, 0.5))
                            continue
                        break
                    
                    if attempt == 1:
                        print(f"Skipping {provider} for {track} - error: {e}")
                    time.sleep(random.uniform(0.1, 0.3)) # Jitter
            
            if not raw_lyrics:
                continue

            current_type = self.detect_type(raw_lyrics)
            detected_lang = self._detect_language(raw_lyrics)
            
            results.append({
                'lyrics': raw_lyrics,
                'type': current_type,
                'lang': detected_lang,
                'provider': provider
            })

            if detected_lang == expected_lang and detected_lang != 'unknown':
                break
                
            if is_latin_metadata and detected_lang == 'en':
                break

        if not results:
            return None, None

        best_result = results[0]
        
        if expected_lang != 'unknown':
            for res in results:
                if res['lang'] == expected_lang:
                    best_result = res
                    break
        
        if is_latin_metadata and best_result['lang'] != 'en':
            for res in results:
                if res['lang'] == 'en':
                    best_result = res
                    break
        
        raw_lyrics = self._clean_lyrics(best_result['lyrics'])
        found_type = best_result['type']

        if requested_type:
            requested_type = requested_type.lower()
            return self.convert_lyrics(raw_lyrics, found_type, requested_type)
        
        return raw_lyrics, found_type

    def _is_mostly_latin(self, text: str) -> bool:
        """Heuristic to check if text is likely English/Latin based."""
        if not text:
            return True
        latin_chars = len(re.findall(r'[a-zA-Z0-9\s\-_.,()\'"&!]', text))
        return (latin_chars / len(text)) > 0.7 if len(text) > 0 else True

    def _detect_language(self, lyrics: str) -> str:
        """Detects the language of the lyrics text."""
        try:
            clean_text = re.sub(r'\[\d+:\d{2}[.:]\d+\]', '', lyrics)
            clean_text = re.sub(r'<\d+:\d{2}[.:]\d+>', '', clean_text)
            clean_text = clean_text.strip()
            
            if not clean_text:
                return 'unknown'
                
            return detect(clean_text)
        except LangDetectException:
            return 'unknown'

    def _clean_lyrics(self, lyrics: str) -> str:
        if not lyrics:
            return ""
        
        # Non-lyric information (credits, metadata)
        pattern = re.compile(r'(' + '|'.join(FORBIDDEN_KEYWORDS) + r'|OP:|SP:)', re.IGNORECASE)
        tag_patterns = [re.compile(tag, re.IGNORECASE) for tag in LRC_TAGS]
        
        lines = lyrics.split('\n')
        cleaned_lines = []
        for line in lines:
            line_clean = re.sub(r'[ \t]+', ' ', line).strip()
            
            # Remove space after word-level timestamps (karaoke format)
            line_clean = re.sub(r'(<\d+:\d{2}[.:]\d+>)\s+(?!<)', r'\1', line_clean)
            
            content_only = re.sub(r'\[\d+:\d{2}[.:]\d+\]', '', line_clean).strip()
            content_only = re.sub(r'<\d+:\d{2}[.:]\d+>', '', content_only).strip()
            
            if any(tag.match(line_clean) for tag in tag_patterns):
                continue
                
            if pattern.search(content_only):
                continue
                
            if line_clean:
                cleaned_lines.append(line_clean)
        
        return '\n'.join(cleaned_lines)

    def detect_type(self, lyrics: str) -> str:
        if not lyrics:
            return "plain"
        
        timestamp_pattern = r'\[\d+:\d{2}[.:]\d+\]'
        enhanced_pattern = r'<\d+:\d{2}[.:]\d+>'
        
        has_line_timestamps = bool(re.search(timestamp_pattern, lyrics, re.MULTILINE))
        has_word_timestamps = bool(re.search(enhanced_pattern, lyrics))

        if has_word_timestamps:
            return "karaoke"
        elif has_line_timestamps:
            return "synced"
        else:
            return "plain"

    def convert_lyrics(self, lyrics: str, current_type: str, target_type: str):
        """
        Converts lyrics from current_type to target_type if possible.
        """
        if current_type == target_type:
            return lyrics, current_type
        
        if target_type == 'karaoke':
            return lyrics, current_type
            
        if target_type == 'synced':
            if current_type == 'karaoke':
                return self.convert_karaoke_to_synced(lyrics), 'synced'
            return lyrics, current_type
            
        if target_type == 'plain':
            return self.convert_to_plain(lyrics), 'plain'

        return lyrics, current_type

    def is_instrumental(self, track: str) -> bool:
        """Checks if a track is likely an instrumental based on its title."""
        keywords = ['instrumental', 'karaoke', 'version instrumental', 'bez slow', 'bez słów', 'orchestral']
        track_lower = track.lower()
        return any(kw in track_lower for kw in keywords)

    def convert_karaoke_to_synced(self, lyrics: str) -> str:
        clean = re.sub(r'<\d+:\d{2}[.:]\d+>', '', lyrics)
        lines = clean.split('\n')
        cleaned_lines = []
        for line in lines:
            line_clean = re.sub(r' +', ' ', line).strip()
            cleaned_lines.append(line_clean)
        return '\n'.join(cleaned_lines)

    def convert_to_plain(self, lyrics: str) -> str:
        no_time = re.sub(r'\[\d+:\d{2}[.:]\d+\]', '', lyrics)
        no_enhanced = re.sub(r'<\d+:\d{2}[.:]\d+>', '', no_time)
        
        lines = no_enhanced.split('\n')
        cleaned_lines = []
        for line in lines:
            line_clean = re.sub(r' +', ' ', line).strip()
            if line_clean:
                cleaned_lines.append(line_clean)
        
        return '\n'.join(cleaned_lines)
