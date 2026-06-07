const API_BASE = 'https://api.synclrc.dev';

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const resultsDropdown = document.getElementById('results-dropdown');
    const lyricsView = document.getElementById('lyrics-view');
    const lyricsContent = document.getElementById('lyrics-content');
    const trackInfo = document.getElementById('track-info');
    const themeToggle = document.getElementById('theme-toggle');
    const loader = document.getElementById('loader');
    const tabs = document.querySelectorAll('.tab');
    const copyButton = document.getElementById('copy-button');
    const apiInfoBtn = document.getElementById('api-info-btn');
    const apiModal = document.getElementById('api-modal');
    const closeModal = document.getElementById('close-modal');
    const welcomeState = document.getElementById('welcome-state');
    const clearSearchBtn = document.getElementById('clear-search');

    let searchTimeout;
    let currentRawLyrics = null;
    let currentLyricsType = null;
    let currentActiveType = 'karaoke';

    const updateIcons = () => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    };

    const initTheme = () => {
        const savedTheme = localStorage.getItem('theme') || 
            (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        setTheme(savedTheme);
    };

    const setTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        const icon = theme === 'dark' ? 'sun' : 'moon';
        themeToggle.innerHTML = `<i data-lucide="${icon}"></i>`;
        updateIcons();
    };

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(searchTimeout);

        if (!query) {
            clearSearchBtn.style.display = 'none';
            resultsDropdown.style.display = 'none';
            lyricsView.style.display = 'none';
            welcomeState.style.display = 'flex';
            return;
        }

        clearSearchBtn.style.display = 'flex';

        searchTimeout = setTimeout(async () => {
            try {
                welcomeState.style.display = 'none';
                const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=6`);
                const data = await response.json();
                renderResults(data.results);
            } catch (err) {
                console.error('Search error:', err);
            }
        }, 300);
    });

    const renderResults = (results) => {
        if (!results.length) {
            resultsDropdown.style.display = 'none';
            return;
        }

        resultsDropdown.innerHTML = results.map(track => `
            <div class="result-item" data-track="${encodeURIComponent(track.trackName)}" data-artist="${encodeURIComponent(track.artistName)}" data-artwork="${track.artworkUrl100}">
                <img src="${track.artworkUrl60}" alt="${track.trackName}">
                <div class="result-text">
                    <div class="result-title">${track.trackName}</div>
                    <div class="result-subtitle">${track.artistName}</div>
                </div>
            </div>
        `).join('');

        resultsDropdown.style.display = 'block';

        resultsDropdown.querySelectorAll('.result-item').forEach(item => {
            item.addEventListener('click', () => {
                const track = decodeURIComponent(item.dataset.track);
                const artist = decodeURIComponent(item.dataset.artist);
                const artwork = item.dataset.artwork.replace('100x100', '400x400');
                fetchLyrics(track, artist, artwork);
            });
        });
    };

    const fetchLyrics = async (track, artist, artwork) => {
        resultsDropdown.style.display = 'none';
        lyricsView.style.display = 'none';
        welcomeState.style.display = 'none';
        loader.style.display = 'block';
        searchInput.value = `${track} — ${artist}`;
        clearSearchBtn.style.display = 'flex';

        try {
            const response = await fetch(`${API_BASE}/lyrics?track=${encodeURIComponent(track)}&artist=${encodeURIComponent(artist)}&_t=${Date.now()}`);
            const data = await response.json();

            if (data.error) throw new Error(data.error);

            const bestType = data.karaoke ? 'karaoke' : data.synced ? 'synced' : 'plain';
            currentRawLyrics = data[bestType];
            currentLyricsType = bestType;
            currentActiveType = bestType;
            
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelector(`.tab[data-type="${bestType}"]`)?.classList.add('active');
            
            displayTrackInfo(track, artist, artwork);
            renderLyrics(currentActiveType);
            
            loader.style.display = 'none';
            lyricsView.style.display = 'block';
        } catch (err) {
            console.error('Lyrics fetch error:', err);
            loader.style.display = 'none';
            displayTrackInfo(track, artist, artwork);
            lyricsContent.innerHTML = `
                <div class="empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="18" r="4"/><path d="M12 18V2l7 4"/></svg>
                    <h3>Lyrics Not Found</h3>
                    <p>Could not find lyrics for this song. Try a different search.</p>
                </div>
            `;
            updateIcons();
            document.querySelector('.controls-actions').style.display = 'none';
            lyricsView.style.display = 'block';
        }
    };

    const displayTrackInfo = (track, artist, artwork) => {
        trackInfo.innerHTML = `
            <img src="${artwork}" alt="${track}">
            <div class="track-details">
                <h2>${track}</h2>
                <p>${artist}</p>
            </div>
        `;
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderLyrics(tab.dataset.type);
        });
    });

    const renderLyrics = (type) => {
        currentActiveType = type;
        
        const typeWeights = { 'karaoke': 3, 'synced': 2, 'plain': 1 };
        const availableWeight = typeWeights[currentLyricsType] || 1;
        const requestedWeight = typeWeights[type] || 1;

        if (requestedWeight > availableWeight) {
            const formatNames = { 'karaoke': 'Karaoke', 'synced': 'Synced' };
            const requestedName = formatNames[type];
            
            lyricsContent.innerHTML = `
                <div class="empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="18" r="4"/><path d="M12 18V2l7 4"/></svg>
                    <h3>${requestedName} Not Available</h3>
                    <p>This song doesn't have ${type} lyrics yet. Please check <b>Synced</b> or <b>Plain</b> tabs.</p>
                    <p style="margin-top: 8px; font-size: 0.85em; opacity: 0.7;">It may appear after a moment... our server checks for higher quality lyrics in the background.</p>
                </div>
            `;
            updateIcons();
            document.querySelector('.controls-actions').style.display = 'none';
            return;
        }

        document.querySelector('.controls-actions').style.display = 'flex';
        const lyrics = processLyrics(currentRawLyrics, type);
        
        if (type !== 'plain') {
            const lineTimestampRegex = /\[\d+:\d{2}[.:]\d+\]/;
            lyricsContent.innerHTML = lyrics.split('\n').map(line => {
                return line.replace(lineTimestampRegex, match => `<span class="karaoke-timestamp">${match}</span>`);
            }).join('\n');
        } else {
            lyricsContent.textContent = lyrics;
        }
    };

    const processLyrics = (text, type) => {
        if (!text) return "";

        const cleanRaw = text.split('\n')
                           .map(line => line.replace(/[ \t]+/g, ' ').trim())
                           .join('\n');

        if (type === 'karaoke') {
            return cleanRaw;
        }

        const lineTimestampRegex = /\[\d+:\d{2}[.:]\d+\]/g;
        const wordTimestampRegex = /<\d+:\d{2}[.:]\d+>/g;

        if (type === 'synced') {
            return cleanRaw.replace(wordTimestampRegex, '')
                           .split('\n')
                           .map(l => l.replace(/[ \t]+/g, ' ').trim())
                           .join('\n');
        }

        if (type === 'plain') {
            return cleanRaw.replace(lineTimestampRegex, '')
                           .replace(wordTimestampRegex, '')
                           .split('\n')
                           .map(l => l.replace(/[ \t]+/g, ' ').trim())
                           .filter(l => l)
                           .join('\n');
        }
    };

    copyButton.addEventListener('click', async () => {
        const textToCopy = processLyrics(currentRawLyrics, currentActiveType);
        try {
            await navigator.clipboard.writeText(textToCopy);
            const originalText = copyButton.innerHTML;
            copyButton.innerHTML = `<i data-lucide="check"></i> Copied`;
            updateIcons();
            setTimeout(() => {
                copyButton.innerHTML = originalText;
                updateIcons();
            }, 2000);
        } catch (err) {
            console.error('Copy failed:', err);
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper')) {
            resultsDropdown.style.display = 'none';
        }
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        resultsDropdown.style.display = 'none';
        lyricsView.style.display = 'none';
        welcomeState.style.display = 'flex';
        searchInput.focus();
    });

    // Modal Logic
    const apiTabs = document.querySelectorAll('.api-tab');
    const apiSections = document.querySelectorAll('.api-section');

    apiTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            apiTabs.forEach(t => t.classList.remove('active'));
            apiSections.forEach(s => s.classList.remove('active'));

            tab.classList.add('active');
            const targetId = tab.dataset.target;
            document.getElementById(targetId).classList.add('active');
        });
    });

    apiInfoBtn.addEventListener('click', () => {
        apiModal.classList.add('active');
        updateIcons();
    });

    closeModal.addEventListener('click', () => {
        apiModal.classList.remove('active');
    });

    apiModal.addEventListener('click', (e) => {
        if (e.target === apiModal) {
            apiModal.classList.remove('active');
        }
    });

    // Save functionality
    const saveButton = document.getElementById('save-button');

    saveButton.addEventListener('click', () => {
        if (!currentRawLyrics) return;
        const text = processLyrics(currentRawLyrics, currentActiveType);
        if (!text) return;

        let ext = 'lrc';
        if (currentActiveType === 'plain') ext = 'txt';

        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const parts = searchInput.value.split(' — ');
        const trackName = parts[0]?.trim() || 'lyrics';
        const artistName = parts[1]?.trim() || '';
        a.download = artistName ? `${trackName} - ${artistName}.${ext}` : `${trackName}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    initTheme();
});
