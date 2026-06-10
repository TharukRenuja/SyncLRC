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
    let searchResultIndex = -1;

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
            resultsDropdown.classList.remove('open');
            lyricsView.style.display = 'none';
            welcomeState.style.display = 'flex';
            return;
        }

        clearSearchBtn.style.display = 'flex';

        searchTimeout = setTimeout(async () => {
            try {
                welcomeState.style.display = 'none';
                const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=6`);
                if (!response.ok) throw new Error('Search service error');
                const data = await response.json();
                renderResults(data.results);
            } catch (err) {
                console.error('Search error:', err);
                resultsDropdown.innerHTML = `
                    <div class="result-item" style="cursor:default;flex-direction:column;gap:0.25rem;padding:1.5rem;text-align:center;pointer-events:none;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        <div style="font-weight:500;margin-top:0.5rem;">Search unavailable</div>
                        <div style="font-size:0.85rem;color:var(--text-secondary);">Couldn't reach the search service. Check your connection or try again.</div>
                    </div>
                `;
                resultsDropdown.classList.add('open');
            }
        }, 300);
    });

    const renderResults = (results) => {
        if (!results.length) {
            resultsDropdown.innerHTML = `
                <div class="result-item" style="cursor:default;flex-direction:column;gap:0.25rem;padding:1.5rem;text-align:center;pointer-events:none;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    <div style="font-weight:500;margin-top:0.5rem;">No results found</div>
                    <div style="font-size:0.85rem;color:var(--text-secondary);">No tracks match your search. Try a different term.</div>
                </div>
            `;
            resultsDropdown.classList.add('open');
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

        resultsDropdown.classList.add('open');

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
        resultsDropdown.classList.remove('open');
        lyricsView.style.display = 'none';
        welcomeState.style.display = 'none';
        loader.style.display = 'block';
        searchInput.value = `${track} — ${artist}`;
        clearSearchBtn.style.display = 'flex';

        try {
            const response = await fetch(`${API_BASE}/lyrics?track=${encodeURIComponent(track)}&artist=${encodeURIComponent(artist)}&_t=${Date.now()}`);
            
            if (response.status === 429) {
                throw { type: 'rate_limit' };
            }
            if (!response.ok) {
                throw { type: 'server_error' };
            }

            const data = await response.json();

            if (data.error) throw { type: 'not_found', message: data.error };

            const bestType = data.karaoke ? 'karaoke' : data.synced ? 'synced' : 'plain';
            if (!data[bestType]) throw { type: 'not_found' };

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
            
            const errorState = err.type || 'server_error';
            const errorMessages = {
                rate_limit: {
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
                    title: 'Rate limit reached',
                    desc: 'You\'ve hit the rate limit. Please wait a moment and try again.'
                },
                not_found: {
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="18" r="4"/><path d="M12 18V2l7 4"/></svg>',
                    title: 'No lyrics available',
                    desc: 'This song doesn\'t have lyrics in our sources yet. Try a different search.'
                },
                server_error: {
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
                    title: 'Something went wrong',
                    desc: 'Couldn\'t load lyrics due to a server error. Please try again later.'
                }
            };

            const msg = errorMessages[errorState] || errorMessages.server_error;
            lyricsContent.innerHTML = `
                <div class="empty-state">
                    ${msg.icon}
                    <h3>${msg.title}</h3>
                    <p>${msg.desc}</p>
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
        if (!lyrics) return;

        const lineTimestampRegex = /\[\d+:\d{2}[.:]\d+\]/;
        const lines = lyrics.split('\n');

        const container = document.createElement('div');
        container.className = 'lyrics-container';

        lines.forEach(line => {
            const div = document.createElement('div');
            div.className = 'lyric-line';
            if (type !== 'plain') {
                div.innerHTML = line.replace(lineTimestampRegex, match => `<span class="karaoke-timestamp">${match}</span>`);
            } else {
                div.textContent = line;
            }
            div.addEventListener('click', () => {
                div.classList.toggle('expanded');
            });
            container.appendChild(div);
        });

        lyricsContent.innerHTML = '';
        lyricsContent.appendChild(container);

        requestAnimationFrame(() => {
            if (container.scrollHeight > container.clientHeight + 2) {
                const btn = document.createElement('button');
                btn.className = 'lyrics-toggle';
                btn.textContent = 'Show all';
                btn.title = `Expand/Collapse (${mod}+E)`;
                btn.style.display = 'block';
                btn.addEventListener('click', () => {
                    container.classList.toggle('expanded');
                    btn.textContent = container.classList.contains('expanded') ? 'Collapse' : 'Show all';
                });
                lyricsContent.appendChild(btn);
            }
        });

        updateIcons();
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
            resultsDropdown.classList.remove('open');
            searchResultIndex = -1;
        }
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        resultsDropdown.classList.remove('open');
        searchResultIndex = -1;
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
    const shortcutsHint = document.getElementById('shortcuts-hint');
    const isMac = navigator.platform?.toLowerCase().includes('mac') || navigator.userAgent.includes('Mac');
    const mod = isMac ? '⌘' : 'Ctrl';

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

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        const isInputFocused = document.activeElement === searchInput;

        if ((e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key === 'k')) && !isInputFocused) {
            e.preventDefault();
            searchInput.focus();
            return;
        }

        if (e.key === 'Escape') {
            if (apiModal.classList.contains('active')) {
                apiModal.classList.remove('active');
                return;
            }
            if (resultsDropdown.classList.contains('open')) {
                resultsDropdown.classList.remove('open');
                searchResultIndex = -1;
                return;
            }
            if (searchInput.value) {
                clearSearchBtn.click();
                return;
            }
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'm' && !isInputFocused) {
            e.preventDefault();
            themeToggle.click();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'i' && !isInputFocused) {
            apiInfoBtn.click();
            e.preventDefault();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !isInputFocused) {
            document.querySelector('.github-link')?.click();
            e.preventDefault();
            return;
        }

        if (resultsDropdown.classList.contains('open')) {
            const items = resultsDropdown.querySelectorAll('.result-item');
            if (!items.length) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                searchResultIndex = Math.min(searchResultIndex + 1, items.length - 1);
                items.forEach((item, i) => {
                    item.style.background = i === searchResultIndex ? 'var(--input-bg)' : '';
                });
                if (searchResultIndex >= 0) items[searchResultIndex].scrollIntoView({ block: 'nearest' });
                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                searchResultIndex = Math.max(searchResultIndex - 1, -1);
                items.forEach((item, i) => {
                    item.style.background = i === searchResultIndex ? 'var(--input-bg)' : '';
                });
                return;
            }

            if (e.key === 'Enter' && searchResultIndex >= 0 && items[searchResultIndex]) {
                e.preventDefault();
                items[searchResultIndex].click();
                return;
            }
        }

        if (e.key >= '1' && e.key <= '3' && lyricsView.style.display !== 'none') {
            const types = ['karaoke', 'synced', 'plain'];
            const type = types[parseInt(e.key) - 1];
            const tab = document.querySelector(`.tab[data-type="${type}"]`);
            if (tab) {
                tab.click();
                e.preventDefault();
            }
            return;
        }

        if ((e.ctrlKey || e.metaKey) && lyricsView.style.display !== 'none') {
            if (e.key === 'c') {
                copyButton.click();
                e.preventDefault();
            }
            if (e.key === 's') {
                e.preventDefault();
                saveButton.click();
            }
            if (e.key === 'e') {
                e.preventDefault();
                document.querySelector('.lyrics-toggle')?.click();
            }
        }
    });

    const updateShortcutHints = () => {
        if (window.innerWidth <= 600) {
            shortcutsHint.style.display = 'none';
            return;
        }
        shortcutsHint.style.display = '';
        shortcutsHint.innerHTML = `
            <span><kbd>${mod}+K</kbd> Search</span>
            <span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Tabs</span>
            <span><kbd>${mod}+M</kbd> Theme</span>
            <span><kbd>${mod}+I</kbd> API</span>
            <span><kbd>${mod}+G</kbd> Source</span>
            <span><kbd>${mod}+E</kbd> Expand</span>
            <span><kbd>Esc</kbd> Close</span>
        `;
        themeToggle.title = `Toggle theme (${mod}+M)`;
        apiInfoBtn.title = `Developer API (${mod}+I)`;
        document.querySelector('.github-link').title = `Source Code (${mod}+G)`;
        copyButton.title = `Copy (${mod}+C)`;
        saveButton.title = `Save (${mod}+S)`;
    };

    updateShortcutHints();
    window.addEventListener('resize', updateShortcutHints);

    initTheme();
});
