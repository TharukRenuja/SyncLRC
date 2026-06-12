export const CREDIT_PATTERNS = [
  // English - require colon/dash after keyword (credit format)
  /^[ \t]*(lyrics?|composed|arranged|produced|mixed|mastered|written|performed|vocals?|music|recorded|engineered|published|engineering)[ \t]+(by|at)[ \t]*[:：-]/i,
  /^[ \t]*co-produced[ \t]+(by|at)[ \t]*[:：-]/i,
  /^[ \t]*(executive|assistant)[ \t]+(producer|engineer)[ \t]*[:：-]/i,
  /^[ \t]*(remix|feature|programmed)[ \t]+(by|at)[ \t]*[:：-]/i,
  /^[ \t]*backing[ \t]+vocals?(?:[ \t]+by)?[ \t]*[:：-]/i,
  /^[ \t]*sound[ \t]+engineer[ \t]*[:：-]/i,
  /^[ \t]*(album|artist|track)[ \t]+by[ \t]*[:：-]/i,
  // Extended credit roles
  /^[ \t]*(lead|backing)?\s*vocals?\s+by\s*[:：-]/i,
  /^[ \t]*vocal\s+production\s+by\s*[:：-]/i,
  /^[ \t]*(cut\s+for\s+vinyl|commissioning\s+country|co-founder|executive\s+producer)(?:[ \t]+by)?\s*[：:]/i,
  // Instrument credits (typically at line start with colon)
  /^[ \t]*(guitar|drums?|bass|piano|keyboards?|violin|cello|saxophone|trumpet|flute|synth(esizer)?s?)[ \t]*[:：-]/i,
  // Instrument credits with "by" (handles "Guitar by:", "Drums by:", etc.)
  /^[ \t]*(guitar|drums?|bass|piano|keyboards?|violin|cello|saxophone|trumpet|flute|synth(esizer)?s?|ghatam|kanjira|santoor|rabab|dholak|tabla|duff)[ \t]+by[ \t]*[:：-]/i,
  // Compound instrument credits ("Ghatam & Kanjira by:", "Rabab & Santoor by:")
  /^[ \t]*(?:\w+\s+(?:&|and)\s+\w+)\s+by\s*[:：-]/i,
  /^[ \t]*\w+(?:,\s*\w+)+\s+by\s*[:：-]/i,
  // Studio / production credits
  /^[ \t]*(production|label|recording|mastering|studio|credits?)[ \t]*[:：-]/i,
  // Assistant / engineering roles
  /^[ \t]*assistant[ \t]+\w+[ \t]+(mix[ \t]+)?engineer[ \t]*[:：-]/i,
  /^[ \t]*assistant[ \t]+\w+[ \t]+by[ \t]*[:：-]/i,
  /^[ \t]*\w+[ \t]+engineering[ \t]+by[ \t]*[:：-]/i,
  // Extended credit prefixes (e.g., "Background Vocals by:", "Mixing Engineer:")
  /^[ \t]*background\s+vocals?\s+by\s*[:：-]/i,
  /^[ \t]*additional\s+vocal\s+by\s*[:：-]/i,
  /^[ \t]*(mixing|vocal|audio)\s+engineer\s*[：:]/i,
  /^[ \t]*vocals?\s+produced\s+by\s*[:：-]/i,
  /^[ \t]*repertoire\s+owner\s*[：:]/i,
  /^[ \t]*lead\s+vocals?\s*[：:]/i,
  // Universal catch-all: line starts with words and ends in a production-role word before colon
  /^[ \t]*\w[\w\s']*(?:engineer|owner|label|studio|director|president|founder|mastered|mixed)[ \t]*[：:]/i,
  // Universal: full-width colon is never used in lyrics, always metadata
  /：/,
  // Legal / PRO entities (never appear in actual lyrics)
  /\((?:ASCAP|BMI|IMRO|STIM|GEMA|PRS|SOCAN|SESAC|BUMA|STEMRA|JASRAC|KOMCA|SACEM|APRA)\)/i,
  // Specific production/org credit lines (anchored for safety)
  /^[ \t]*suki[ \t]+music[ \t]+vocal[ \t]+production[ \t]+by[ \t]*[:：-]/i,
  /^[ \t]*citizens[ \t]+of[ \t]+the[ \t]+world[ \t]+choir[ \t]+recorded[ \t]+at/i,
  // Chinese
  /^[ \t]*(作词|作曲|编曲|制作人|音频工程师|母带工程师|人声|混音师|混音|录音|翻译|翻唱|监制|和声|作詞|編曲|歌い手|ボーカル|ミックス|マスタリング|演奏|制作|編集|プロデューサー|レコーディング|エンジニア|翻訳者|작사|작곡|편곡|보컬|프로듀싱|믹싱|마스터링|번역|녹음|프로듀서|발매|코러스)[ \t]*[:：]/,
  /^[ \t]*(词|曲|歌|唄|OP|SP)[ \t]*[：:]/,
  /^[ \t]*(歌词|出品|版权|企划|出品人|가사|엔지니어|레이블|레코딩|작곡가|편곡가)[ \t]*[：:]/,
  /^[ \t]*(吉他|鼓|合成器|贝斯|钢琴|键盘|发行|ギター|ドラム|ベース|ピアノ|キーボード|기타|드럼|베이스|피아노|신디사이저)[ \t]*[：:]/,
  // Chinese (spaced — handles word-timestamp fragmentation between CJK chars)
  /^[ \t]*原\s*曲\s*[：:]/,
  /^[ \t]*作\s*(词|曲)\s*[：:]/,
  /^[ \t]*歌\s*词?\s*[：:]/,
  /^[ \t]*(词|曲|歌|唄)\s*[：:]/,
  // Japanese/Korean bare keyword at start (less common but safe with colon)
  /^[ \t]*(歌い手|ボーカル|演奏|編集|翻訳|코러스|엔지니어|앨범|아티스트|제목|바이올린|첼로|섹소폰|트럼펫|플루트)[ \t]*[：:]/,
  // Spanish
  /^[ \t]*(letra|letras|compuesta|arreglada|producida|mezclada|masterizada|escrita|interpretada)[ \t]+(por|en)[ \t]*[:：-]/i,
  /^[ \t]*grabado[ \t]+(en|a)[ \t]*[:：-]/i,
  /^[ \t]*(producido|mezclado)[ \t]+(por|en)[ \t]*[:：-]/i,
  /^[ \t]*música[ \t]+(por|de)[ \t]*[:：-]/i,
  // French
  /^[ \t]*(paroles|composé|arrangé|produit|mixé|masterisé|écrit|interprété)[ \t]+(par|à)[ \t]*[:：-]/i,
  /^[ \t]*enregistré[ \t]+(à|au)[ \t]*[:：-]/i,
  /^[ \t]*(musique|producteur)[ \t]+(par|de)[ \t]*[:：-]/i,
  // German
  /^[ \t]*(songtext|komponiert|arrangiert|produziert|gemischt|gemastert|geschrieben|gesungen)[ \t]+(von|in|zu)[ \t]*[:：-]/i,
  /^[ \t]*musik[ \t]+(von|aus)[ \t]*[:：-]/i,
  // Italian
  /^[ \t]*(parole|composto|arrangiato|prodotto|mixato|masterizzato|scritto|interpretato)[ \t]+(di|da|presso)[ \t]*[:：-]/i,
  /^[ \t]*musica[ \t]+(di|da)[ \t]*[:：-]/i,
  // Portuguese
  /^[ \t]*(letra|composta|arranjada|produzida|mixada|masterizada|escrita|interpretada)[ \t]+(por|em)[ \t]*[:：-]/i,
  /^[ \t]*gravado[ \t]+(em|a)[ \t]*[:：-]/i,
  // Russian
  /^[ \t]*(слова|музыка|аранжировка|продюсер|сведение|мастеринг|вокал|гитара|барабаны|бас|клавишные|запись|студия|исполнитель|звукорежиссер|автор[ \t]+текста|композитор|бэк-вокал|ударные|скрипка|художник|дизайн|аранжировщик)[ \t]*[:：-]/i,
  /^[ \t]*(альбом|трек|название|исполнитель)[ \t]*[:：-]/i,
  // Hindi
  /^[ \t]*(बोल|संगीत|रचना|निर्माता|उत्पादन|रिकॉर्डिंग|स्टूडियो|गायक|गिटार|ड्रम|पियानो|वायलिन|एल्बम|कलाकार)[ \t]*[:：-]/,
  // Arabic
  /^[ \t]*(كلمات|ألحان|توزيع|إنتاج|تسجيل|استوديو|غناء|عازف|جيتار|طبل|بيانو|كمان|موسيقى|ألبوم|فنان)[ \t]*[:：-]/,
  // Tamil
  /^[ \t]*(பாடல்|இசை|பாடியவர்|வரிகள்|இசையமைப்பு)[ \t]*[:：-]/,
  // Thai
  /^[ \t]*(เนื้อร้อง|ทำนอง|เรียบเรียง|ขับร้อง|ดนตรี)[ \t]*[:：-]/,
  // Vietnamese
  /^[ \t]*(lời[ \t]+bài[ \t]+hát|nhạc[ \t]+sĩ|ca[ \t]+sĩ|hòa[ \t]+âm|phối[ \t]+khí|sản[ \t]+xuất)[ \t]*[:：-]/i,
  // Indonesian / Malay
  /^[ \t]*(lirik|penyanyi|pencipta|musik|produksi|rekaman|gitar|drum|bas)[ \t]*[:：-]/i,
  // Tagalog / Filipino
  /^[ \t]*(titik|awit|musika|pagkakaayos|nirekord[ \t]+sa|gitara|tambol)[ \t]*[:：-]/i,
  // Burmese
  /^[ \t]*(တေးဆို|တေးရေး|တေးဂီတ|တေးအယ်လ်ဘမ်)[ \t]*[:：-]/,
  // Standard LRC metadata tags
  /^\[(ar|ti|al|au|by|offset|re|ve|la|length|id|encoding|bn):/i,
  /^\[(ar|ti|al|au|by|offset|re|ve|la|length|id|encoding|bn)\]/i,
  // Track/Artist credit line (e.g., "Song Name - Artist Name")
  /^[A-Z][A-Za-z\s'.!?]*[-–—]\s*[A-Z][A-Za-z\s'.!?]+$/,
  // Song with parenthetical tag before artist (e.g., "Song (Tag) - Artist")
  /^.+?[ \t]*\([^)]*\)[ \t]*[-–—]\s*.+$/,
  // Person - Role credit (e.g., "Becky Dell - CEO, Co-Founder & Conductor...")
  /^[A-Z][a-z]+ [A-Z][a-z]+ - (CEO|Co-Founder|Conductor|President|Director|Founder)\b/,
];

function normalizeWhitespace(text) {
  return text
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function sanitizeLyrics(lyrics) {
  if (!lyrics) return lyrics;
  return lyrics.split('\n').filter(line => {
    const text = line.replace(/\[\d+:\d{2}[.:]\d+\]/g, '').replace(/<\d+:\d{2}[.:]\d+>/g, '');
    const cleaned = normalizeWhitespace(text);
    return cleaned && !CREDIT_PATTERNS.some(p => p.test(cleaned));
  }).map(line => normalizeWhitespace(line)).join('\n');
}
