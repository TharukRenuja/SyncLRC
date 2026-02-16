import re
import syncedlyrics

class LyricsFetcher:
    def get_lyrics(self, track: str, artist: str, requested_type: str = None):
        """
        Fetches lyrics and processes them based on the requested type.
        Priority: Karaoke (Enhanced) -> Synced -> Plain
        """
        search_term = f"{track} {artist}"
        
        raw_lyrics = syncedlyrics.search(search_term, enhanced=True)
        
        if raw_lyrics and self.detect_type(raw_lyrics) == 'karaoke':
             pass
        else:
             raw_lyrics_standard = syncedlyrics.search(search_term)
             if raw_lyrics_standard:
                 raw_lyrics = raw_lyrics_standard

        if not raw_lyrics:
            return None, None

        found_type = self.detect_type(raw_lyrics)
        
        raw_lyrics = self._clean_lyrics(raw_lyrics)

        if requested_type:
            requested_type = requested_type.lower()
            return self.convert_lyrics(raw_lyrics, found_type, requested_type)
        
        return raw_lyrics, found_type

    def _clean_lyrics(self, lyrics: str) -> str:
        if not lyrics:
            return ""
        
        # Non-lyric information (credits, metadata)
        forbidden_keywords = [
            '作词', '作曲', '制作人', '音频工程师', '母带工程师', '人声', '混音师', '混音', '编曲', '录音',
            'Lyrics by', 'Composed by', 'Arranged by', 'Produced by', 'Mixed by', 'Mastered by',
            'Written by', 'Performed by', 'Vocals by', 'Mixed at', 'Mastered at', 'Studio'
        ]
        
        pattern = re.compile(r'(' + '|'.join(forbidden_keywords) + r'|OP:|SP:)', re.IGNORECASE)
        
        lines = lyrics.split('\n')
        cleaned_lines = []
        for line in lines:
            line_clean = re.sub(r'[ \t]+', ' ', line).strip()
            
            content_only = re.sub(r'\[\d+:\d{2}[.:]\d+\]', '', line_clean).strip()
            content_only = re.sub(r'<\d+:\d{2}[.:]\d+>', '', content_only).strip()
            
            if pattern.search(content_only) and len(content_only) < 100:
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
