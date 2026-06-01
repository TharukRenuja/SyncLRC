export const CREDIT_PATTERNS = [
  // English
  /lyrics? by/i, /composed by/i, /arranged by/i, /produced by/i, /mixed by/i, /mastered by/i,
  /written by/i, /performed by/i, /vocals? by/i, /music by/i, /recorded by/i, /engineered by/i,
  /mixed at/i, /mastered at/i, /recorded at/i, /co-produced by/i, /executive producer/i,
  /backing vocals?/i, /programmed by/i, /remix by/i, /feature by/i,
  /sound engineer/i, /assistant engineer/i, /synthesizers?/i,
  /guitar/i, /drums/i, /bass/i, /piano/i, /keyboards/i, /violin/i, /cello/i,
  /saxophone/i, /trumpet/i, /flute/i, /synth/i, /synthesizer/i,
  /production/i, /label/i, /recording/i, /mastering/i, /studio/i, /credits?/i,
  /album by/i, /artist by/i, /track by/i,
  // Chinese
  /作词/, /作曲/, /编曲/, /制作人/, /音频工程师/, /母带工程师/, /人声/,
  /混音师/, /混音/, /录音/, /词[：:]/, /曲[：:]/, /翻译/, /翻唱/, /监制/, /和声/,
  /OP[：:]/, /SP[：:]/, /歌词/, /出品/, /版权/, /企划/, /出品人/,
  /吉他/, /鼓/, /合成器/, /贝斯/, /钢琴/, /键盘/, /发行/,
  // Japanese
  /作詞/, /編曲/, /歌い手/, /ボーカル/, /ミックス/,
  /マスタリング/, /演奏/, /制作/, /編集/, /歌[：:]/, /唄[：:]/,
  /ギター/, /ドラム/, /ベース/, /ピアノ/, /キーボード/, /プロデューサー/,
  /レコーディング/, /エンジニア/, /翻訳者/,
  // Korean
  /작사/, /작곡/, /편곡/, /보컬/, /프로듀싱/, /믹싱/, /마스터링/,
  /가사/, /번역/, /녹음/, /기타/, /드럼/, /베이스/, /피아노/,
  // Spanish
  /letra por/i, /letras por/i, /compuesta por/i, /arreglada por/i, /producida por/i,
  /mezclada por/i, /masterizada por/i, /escrita por/i, /interpretada por/i,
  /música por/i, /grabado en/i, /producido por/i, /mezclado por/i,
  // French
  /paroles par/i, /composé par/i, /arrangé par/i, /produit par/i, /mixé par/i,
  /masterisé par/i, /écrit par/i, /interprété par/i, /musique par/i,
  /enregistré à/i, /producteur/i,
  // German
  /songtext von/i, /komponiert von/i, /arrangiert von/i, /produziert von/i,
  /gemischt von/i, /gemastert von/i, /geschrieben von/i, /gesungen von/i,
  /musik von/i, /aufgenommen in/i,
  // Italian
  /parole di/i, /composto da/i, /arrangiato da/i, /prodotto da/i, /mixato da/i,
  /masterizzato da/i, /scritto da/i, /interpretato da/i, /musica di/i,
  /registrato presso/i,
  // Portuguese
  /letra por/i, /composta por/i, /arranjada por/i, /produzida por/i, /mixada por/i,
  /masterizada por/i, /escrita por/i, /interpretada por/i, /música por/i,
  /gravado em/i,
  // Russian
  /слова/i, /музыка/i, /аранжировка/i, /продюсер/i, /сведение/i, /мастеринг/i,
  /вокал/i, /гитара/i, /барабаны/i, /бас/i, /клавишные/i, /запись/i, /студия/i,
  /исполнитель/i, /звукорежиссер/i, /автор текста/i, /композитор/i,
  /бэк-вокал/i, /ударные/i, /скрипка/i,
  // Hindi
  /बोल/i, /संगीत/i, /रचना/i, /निर्माता/i, /गायक/i, /रिकॉर्डिंग/i, /स्टूडियो/i,
  // Arabic
  /كلمات/i, /ألحان/i, /توزيع/i, /إنتاج/i, /تسجيل/i, /استوديو/i, /غناء/i,
  // Tamil
  /பாடல்/i, /இசை/i, /பாடியவர்/i, /வரிகள்/i, /இசையமைப்பு/i,
  // Thai
  /เนื้อร้อง/i, /ทำนอง/i, /เรียบเรียง/i, /ขับร้อง/i,
  // Vietnamese
  /lời bài hát/i, /nhạc sĩ/i, /ca sĩ/i, /hòa âm/i, /phối khí/i, /sản xuất/i,
  // Indonesian / Malay
  /lirik/i, /penyanyi/i, /pencipta/i, /musik/i, /produksi/i, /rekaman/i,
  // Standard LRC metadata tags
  /^\[ar:/, /^\[ti:/, /^\[al:/, /^\[au:/, /^\[by:/, /^\[offset:/, /^\[re:/, /^\[ve:/, /^\[la:/
];

export function sanitizeLyrics(lyrics) {
  if (!lyrics) return lyrics;
  return lyrics.split('\n').filter(line => {
    const text = line.replace(/\[\d+:\d{2}[.:]\d+\]/g, '').replace(/<\d+:\d{2}[.:]\d+>/g, '').trim();
    return text && !CREDIT_PATTERNS.some(p => p.test(text));
  }).join('\n');
}
