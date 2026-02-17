import re
import syncedlyrics
from langdetect import detect, DetectorFactory
from langdetect.lang_detect_exception import LangDetectException

DetectorFactory.seed = 0

class LyricsFetcher:
    def get_lyrics(self, track: str, artist: str, requested_type: str = None):
        """
        Fetches lyrics and processes them based on the requested type.
        Priority: Karaoke (Enhanced) -> Synced -> Plain
        """
        search_term = f"{track} {artist}"
        
        # Detect expected language from metadata
        expected_lang = self._detect_language(f"{track} {artist}")
        is_latin_metadata = self._is_mostly_latin(track) and self._is_mostly_latin(artist)
        
        providers = ["musixmatch", "lrclib", "netease"]
        results = []

        for provider in providers:
            raw_lyrics = syncedlyrics.search(search_term, enhanced=True, providers=[provider])
            if not raw_lyrics:
                raw_lyrics = syncedlyrics.search(search_term, enhanced=False, providers=[provider])
            
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

            # 1. Matches expected language precisely
            if detected_lang == expected_lang and detected_lang != 'unknown':
                break
                
            # 2. English preference (even if detect() was unsure)
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
        
        # Secondary check for English in songs
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
        forbidden_keywords = [
            '作词', '作曲', '制作人', '音频工程师', '母带工程师', '人声', '混音师', '混音', '编曲', '录音',
            '作曲家', '作詞', '編曲', '歌词', '词', '曲', '翻译', '翻唱', '编曲家', '监制', '和声',
            'Lyrics by', 'Composed by', 'Arranged by', 'Produced by', 'Mixed by', 'Mastered by',
            'Written by', 'Performed by', 'Vocals by', 'Mixed at', 'Mastered at', 'Studio',
            'Music by', 'Lyrics by'
        ]
        
        pattern = re.compile(r'(' + '|'.join(forbidden_keywords) + r'|OP:|SP:)', re.IGNORECASE)
        
        lines = lyrics.split('\n')
        cleaned_lines = []
        for line in lines:
            line_clean = re.sub(r'[ \t]+', ' ', line).strip()
            
            # Remove space after word-level timestamps (karaoke format)
            # [00:01.26] <00:01.26> Baby -> [00:01.26] <00:01.26>Baby
            line_clean = re.sub(r'(<\d+:\d{2}[.:]\d+>)\s+(?!<)', r'\1', line_clean)
            
            content_only = re.sub(r'\[\d+:\d{2}[.:]\d+\]', '', line_clean).strip()
            content_only = re.sub(r'<\d+:\d{2}[.:]\d+>', '', content_only).strip()
            
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
