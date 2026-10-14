import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../static/js/script.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function renderLyricLine'), source.indexOf("document.addEventListener('DOMContentLoaded'"));
const document = {
    createTextNode(text) { return { textContent: text }; },
    createElement() { return { textContent: '', className: '' }; }
};
const render = runInNewContext(helper + '\nrenderLyricLine', { document });
for (const text of [
    '[00:33.06]{agent:v1}{bg}<00:33.06>Echo<00:36.20>',
    '[00:34.59]<00:34.59>bro<00:35.05>ken <00:35.49>road<00:35.81>',
    '[00:53.98]<00:53.98>chain <00:54.67><00:54.91>that',
    '[00:01.00](Literal parentheses) <img src=x onerror=alert(1)> & text',
    '[00:01.00]你好', '', 'plain text'
]) {
    const classes = new Set();
    const element = { children: [], classList: { add(c) { classes.add(c); } }, appendChild(c) { this.children.push(c); } };
    render(element, text, true);
    assert.equal(element.children.map(c => c.textContent).join(''), text);
    assert.equal(classes.has('background-line'), text.includes('{bg}'));
    for (const marker of element.children.filter(c => c.className)) assert(marker.title);
    if (text.includes('{bg}')) {
        assert(element.children.some(c => c.className === 'vocal-marker agent-marker'));
        assert(element.children.some(c => c.className === 'vocal-marker background-marker'));
        assert(element.children.some(c => c.className === 'karaoke-timestamp word-timestamp'));
    }
}
assert(!helper.includes('innerHTML'));
console.log('PASS: safe marker rendering, exact text/spacing, syllables, gaps, CJK, literal HTML and background classification');

for (const karaoke of [true, false]) {
    const element = { children: [], classList: { add() {} }, appendChild(c) { this.children.push(c); } };
    render(element, '[00:01.00]<00:01.00>Word', karaoke);
    const line = element.children.find(c => c.title === 'Line timestamp');
    assert.equal(line.className.includes('line-timestamp-emphasis'), karaoke);
    assert.equal(line.className.includes('synced-timestamp'), !karaoke);
    assert.equal(element.children.find(c => c.title === 'Word timestamp').className, 'karaoke-timestamp word-timestamp');
}
console.log('PASS: bold line timestamps only in karaoke; word timestamps retain muted styling');

const vocals = source.slice(source.indexOf('    const fetchVocals = async'), source.indexOf('    vocalInputs.forEach(input => input.addEventListener'));
for (const type of ['karaoke', 'synced', 'plain']) {
    const requests = [];
    const inputs = ['agents', 'background'].map(value => ({ value, checked: true, disabled: type === 'plain' }));
    const context = { vocalInputs: inputs, currentActiveType: type, currentTrack: {track:'Fixture',artist:'Artist'}, vocalRequestId: 0,
        vocalLyrics: null, API_BASE: 'https://test', URLSearchParams, showVocalStatus() {}, renderLyrics() {},
        fetch: async url => { requests.push(new URL(url)); return {ok:true,json:async()=>({type,lyrics:'Selected output',features:{unavailable:[],unknown:[]}})}; } };
    const fetchVocals = runInNewContext(vocals + '\nfetchVocals', context);
    await fetchVocals();
    if (type === 'plain') {
        assert.equal(requests.length, 0);
        assert.equal(context.vocalLyrics, null);
        continue;
    }
    assert.equal(requests[0].searchParams.get('type'), type);
    assert.equal(requests[0].searchParams.get('include'), type === 'plain' ? 'background' : 'agents,background');
    assert.equal(context.vocalLyrics.type, type);
    assert.equal(context.vocalLyrics.lyrics, 'Selected output');
    context.fetch = async () => ({ ok:true,json:async()=>({type,lyrics:'Fallback',features:{unavailable:['background'],unknown:[]}}) });
    await fetchVocals();
    assert.equal(inputs[1].checked, false);
    inputs.forEach(input => { input.checked = true; });
    context.fetch = async () => { throw new Error('Source unavailable'); };
    await fetchVocals();
    assert(inputs.every(input => !input.checked), 'failed requests must reset selected switches');
    let resolve;
    inputs[1].checked = true;
    context.fetch = () => new Promise(r => { resolve = r; });
    const pending = fetchVocals();
    context.vocalRequestId++;
    resolve({ok:true,json:async()=>({type,lyrics:'Stale response'})});
    await pending;
    assert.equal(context.vocalLyrics, null);
}
assert.equal((source.match(/vocalLyrics\?\.type === currentActiveType \? vocalLyrics.lyrics : currentRawLyrics/g) || []).length, 2, 'copy and save must use the active format');
console.log('PASS: active-format vocal requests, plain makes no vocal request, unavailable reset, stale response ignored, copy/save select active output');
