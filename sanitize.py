# A list of credit and metadata keywords across multiple languages
# This file serves as a central repository for lyrics sanitization keywords.

FORBIDDEN_KEYWORDS = [
    # English
    'Lyrics by', 'Composed by', 'Arranged by', 'Produced by', 'Mixed by', 'Mastered by',
    'Written by', 'Performed by', 'Vocals by', 'Mixed at', 'Mastered at', 'Studio',
    'Music by', 'Lyrics by', 'Album by', 'Artist by', 'Track by', 'Credits by',
    'Guitar', 'Drums', 'Synth', 'Synthesizer', 'Bass', 'Piano', 'Keyboards', 'Violin',
    'Cello', 'Saxophone', 'Trumpet', 'Flute', 'Engineer', 'Production', 'Label',
    'Remix by', 'Feature by', 'Backing vocals', 'Recording', 'Mastering', 'Sound engineer',
    'Co-produced by', 'Assistant engineer', 'Executive producer', 'Synthesizers', 'Programmed by',
    
    # Spanish
    'Letra por', 'Letras por', 'Compuesta por', 'Arreglada por', 'Producida por', 'Mezclada por', 
    'Masterizada por', 'Escrita por', 'Interpretada por', 'Vocales por', 'Música por',
    'Guitarra', 'Batería', 'Bajo', 'Teclados', 'Violín', 'Violonchelo', 'Saxofón', 'Trompeta', 'Flauta',
    'Producido por', 'Mezclado por', 'Escrito por', 'Grabado en',
    
    # French
    'Paroles par', 'Composé par', 'Arrangé par', 'Produit par', 'Mixé par', 'Masterisé par', 
    'Écrit par', 'Interprété par', 'Chant par', 'Musique par',
    'Guitare', 'Batterie', 'Basse', 'Clavier', 'Violon', 'Violoncelle', 'Saxophone', 'Trompette', 'Flûte',
    'Enregistré à', 'Producteur', 'Mixage',
    
    # German
    'Songtext von', 'Komponiert von', 'Arrangiert von', 'Produziert von', 'Gemischt von', 
    'Gemaatert von', 'Geschrieben von', 'Gesungen von', 'Musik von',
    'Gitarre', 'Schlagzeug', 'Bass', 'Keyboard', 'Violine', 'Violoncello', 'Saxophon', 'Trompete', 'Flöte',
    'Aufgenommen in', 'Produzent', 'Mischung',
    
    # Italian
    'Parole di', 'Composto da', 'Arrangiato da', 'Prodotto da', 'Mixato da', 'Masterizzato da', 
    'Scritto da', 'Interpretato da', 'Voci di', 'Musica di',
    'Chitarra', 'Batteria', 'Basso', 'Tastiere', 'Violino', 'Violoncello', 'Sassofono', 'Tromba', 'Flauto',
    'Registrato presso', 'Produttore', 'Mixaggio',
    
    # Portuguese
    'Letra por', 'Composta por', 'Arranjada por', 'Produzida por', 'Mixada por', 'Masterizada por', 
    'Escrita por', 'Interpretada por', 'Vocais por', 'Música por',
    'Guitarra', 'Bateria', 'Baixo', 'Teclados', 'Violino', 'Violoncelo', 'Saxofone', 'Trompete', 'Flauta',
    'Gravado em', 'Produtor', 'Mixagem',
    
    # Russian
    'Слова', 'Музыка', 'Аранжировка', 'Продюсер', 'Сведение', 'Мастеринг', 
    'Вокал', 'Гитара', 'Барабаны', 'Бас', 'Клавишные', 'Запись', 'Студия',
    'Альбом', 'Исполнитель', 'Трек', 'Название', 'Звукорежиссер', 'Мастеринг',
    'Автор текста', 'Композитор', 'Аранжировщик', 'Художник', 'Дизайн',
    'Автор музыки', 'Бэк-вокал', 'Клавиши', 'Ударные', 'Скрипка', 'Саксофон',
    
    # Chinese (Simplified & Traditional)
    '作词', '作曲', '制作人', '音频工程师', '母带工程师', '人声', '混音师', '混音', '编曲', '录音',
    '作曲家', '作詞', '編曲', '歌词', '词', '曲', '翻译', '翻唱', '编曲家', '监制', '和声',
    '吉他', '鼓', '合成器', '贝斯', '钢琴', '键盘', '和音', '助理', '发行', '后期',
    '乐队', '发行公司', '企划', '出品', '版权', '录音室', '混音室', '母带室',
    '艺人', '专辑', '歌词由', '监制', '总监', '策划', '出品人',
    
    # Japanese
    '歌い手', 'ボーカル', '作詞', '作曲', '編曲', 'ミックス', 'マスタリング',
    '歌', '唄', '演奏', '制作', '編集', '翻訳',
    'アルバム', 'アーティスト', 'タイトル', 'ギター', 'ドラム', 'ベース', 'ピアノ',
    'キーボード', 'プロデューサー', 'レコーディング', 'エンジニア', '翻訳者',
    'バイオリン', 'チェロ', 'サックス', 'トランペット', 'フルート', 'コーラス',
    
    # Korean
    '작사', '작곡', '편곡', '보컬', '프로듀싱', '믹싱', '마스터링',
    '노래', '연주', '제작', '녹음', '가사', '번역',
    '앨범', '아티스트', '제목', '기타', '드럼', '베이스', '피아노', '신디사이저',
    '키보드', '엔지니어', '프로듀서', '발매', '코러스', '바이올린', '첼로', '섹소폰',

    # Arabic
    'كلمات', 'ألحان', 'توزيع', 'إنتاج', 'تسجيل', 'استوديو', 'غناء', 'عازف', 
    'جيتار', 'طبل', 'بيانو', 'كمان', 'موسيقى', 'ألبوم', 'فنان',
    
    # Hindi
    'बोल', 'संगीत', 'रचना', 'निर्माता', 'उत्पादन', 'रिकॉर्डिंग', 'स्टूडियो', 'गायक', 
    'गिटार', 'ड्रम', 'पियानो', 'वायलिन', 'एल्बम', 'कलाकार',

    # Sinhala
    'පද රචනය', 'සංගීතය', 'ගායනය', 'තනු', 'සංගීත නිර්මාණය', 'ගායනයෙන්',
    
    # Tamil
    'பாடல்', 'இசை', 'பாடியவர்', 'வரிகள்', 'இசையமைப்பு',
    
    # Indonesian / Malay
    'Lirik', 'Penyanyi', 'Pencipta', 'Musik', 'Produksi', 'Rekaman', 'Gitar', 'Drum', 'Bas',
    
    # Tagalog / Filipino
    'Titik', 'Awit', 'Musika', 'Pagkakaayos', 'Nirekord sa', 'Gitara', 'Tambol',
    
    # Burmese
    'တေးဆို', 'တေးရေး', 'တေးဂီတ', 'တေးအယ်လ်ဘမ်',
    
    # Thai
    'เนื้อร้อง', 'ทำนอง', 'เรียบเรียง', 'ขับร้อง', 'ดนตรี',
    
    # Vietnamese
    'Lời bài hát', 'Nhạc sĩ', 'Ca sĩ', 'Hòa âm', 'Phối khí', 'Sản xuất'
]

# Standard LRC metadata identification tags as regex patterns
LRC_TAGS = [
    r'\[ar:.*\]', r'\[ti:.*\]', r'\[al:.*\]', r'\[au:.*\]', r'\[by:.*\]',
    r'\[offset:.*\]', r'\[re:.*\]', r'\[ve:.*\]', r'\[la:.*\]'
]
