/* ============================================================
   Vanilla Creme Radio — Mobile PWA
   Port der Desktop-App (Tauri) auf reines Web.
   - Radio-Browser-API: direkter fetch (CORS erlaubt), Mirror-Fallback
   - hearthis.at (DJ Sets): direkter fetch, mit Fallback-Hinweis
   - Wiedergabe: direkt übers <audio>-Element (keine Web-Audio-Kette,
     da Cross-Origin-Streams im Browser sonst stumm blieben)
   - Lockscreen-Steuerung: Media Session API
   ============================================================ */
'use strict';

/* ── Radio-Browser Mirrors ── */
const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
];

async function radioApi(path) {
  let lastErr = 'keine Mirrors erreichbar';
  for (const base of MIRRORS) {
    try {
      const res = await fetch(`${base}/json/${path}`, { headers: { Accept: 'application/json' } });
      if (res.ok) return await res.json();
      lastErr = 'HTTP ' + res.status;
    } catch (e) { lastErr = String(e); }
  }
  throw new Error(lastErr);
}

async function hearthisApi(path) {
  // hearthis.at liefert gelegentlich leere 200er — mehrfach versuchen.
  let lastErr = 'leere Antwort';
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`https://api-v2.hearthis.at/${path}`, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const body = await res.text();
        if (body && body.trim().length > 2) return JSON.parse(body);
        lastErr = 'leere Antwort';
      } else { lastErr = 'HTTP ' + res.status; }
    } catch (e) { lastErr = String(e); }
    if (i < 3) await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(lastErr);
}

/* ── DOM ── */
const $ = (id) => document.getElementById(id);
const audio   = $('audio');
const audioDj = $('audio-dj');
const volumeEl = $('volume');

/* ── State ── */
const DEFAULT_STATIONS = [
  { name: 'SomaFM Groove Salad', url: 'https://ice2.somafm.com/groovesalad-128-mp3', genre: 'Ambient' },
  { name: 'SomaFM Beat Blender', url: 'https://ice2.somafm.com/beatblender-128-mp3', genre: 'Electronic' },
  { name: 'DLF Nova',            url: 'https://st03.sslstream.dlf.de/dlf/03/128/mp3/stream.mp3', genre: 'News' },
];
const DEFAULT_GENRES = ['Electronic','Techno','Jazz','Klassik','News','Pop','Rock','Ambient','Sonstige'];

let stations = [];
let genres = [];
let currentIdx = -1;
let playing = false;
let activeGenre = 'all';
let currentStreamUrl = '';
let currentUrl = '';
let isDjMode = false;
let currentDjIsLive = false;
let editingIdx = -1;

const isIOS = /iP(hone|od|ad)/.test(navigator.platform) ||
  (navigator.userAgent.includes('Mac') && 'ontouchend' in document);

/* ── Persistence ── */
function loadData() {
  try {
    const s = localStorage.getItem('radio_stations');
    const g = localStorage.getItem('radio_genres');
    stations = s ? JSON.parse(s) : [...DEFAULT_STATIONS];
    genres   = g ? JSON.parse(g) : [...DEFAULT_GENRES];
  } catch (e) {
    stations = [...DEFAULT_STATIONS];
    genres = [...DEFAULT_GENRES];
  }
  stations.forEach(st => { if (st.genre && !genres.includes(st.genre)) genres.push(st.genre); });
}
function saveData() {
  try {
    localStorage.setItem('radio_stations', JSON.stringify(stations));
    localStorage.setItem('radio_genres', JSON.stringify(genres));
  } catch (e) {}
}
function saveLastPlayed(idx) {
  try { if (idx >= 0) localStorage.setItem('radio_last', String(idx)); } catch (e) {}
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Status + Now Playing UI ── */
const npName       = $('np-name');
const npStatus     = $('np-status');
const npSheetTitle = $('np-sheet-title');
const npSheetGenre = $('np-sheet-genre');
const npSheetStatus= $('np-sheet-status');
const nowBar       = $('now-bar');

function setStatus(cls, text) {
  npStatus.className = 'np-status ' + cls;
  npStatus.textContent = text;
  npSheetStatus.className = 'np-sheet-status ' + cls;
  npSheetStatus.textContent = text;
}

function setNowPlaying(name, genre) {
  npName.textContent = name || 'Kein Sender';
  npSheetTitle.textContent = name || 'Kein Sender';
  npSheetGenre.textContent = genre || '';
  nowBar.classList.toggle('on', !!name);
  updateMediaMetadata(name, genre);
}

const PLAY_SVG  = '<polygon points="4,2 14,8 4,14"/>';
const PAUSE_SVG = '<rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/>';
function updatePlayBtn() {
  const svg = playing ? PAUSE_SVG : PLAY_SVG;
  $('mini-icon').innerHTML = svg;
  $('np-play-icon').innerHTML = svg;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }
}

/* ── Media Session (Lockscreen) ── */
function updateMediaMetadata(title, genre) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'Vanilla Creme Radio',
      artist: genre || 'Vanilla Creme Radio',
      album: 'Vanilla Creme Radio',
      artwork: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
  } catch (e) {}
}
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const h = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) {} };
  h('play',  () => startPlayback());
  h('pause', () => stopPlayback());
  h('nexttrack',     () => nextStation());
  h('previoustrack', () => prevStation());
}

/* ── Playback ── */
function applyVolume() {
  const v = parseFloat(volumeEl.value);
  audio.volume = v;
  audioDj.volume = v;
}

const PAGE_IS_HTTPS = location.protocol === 'https:';

function playUrl(el, url) {
  // Auf einer HTTPS-Seite blockiert der Browser http-Streams (Mixed Content).
  // Deshalb zuerst die https-Variante derselben Adresse versuchen.
  if (PAGE_IS_HTTPS && /^http:\/\//i.test(url)) {
    url = url.replace(/^http:/i, 'https:');
    el.dataset.upgraded = '1';
  } else {
    delete el.dataset.upgraded;
  }
  setStatus('loading', 'Verbinde…');
  el.src = url;
  applyVolume();
  const p = el.play();
  if (p && p.catch) p.catch(() => {});
}

function stopOther(keep) {
  if (keep !== audio)   { try { audio.pause(); } catch (e) {} }
  if (keep !== audioDj) { try { audioDj.pause(); audioDj.src = ''; } catch (e) {} }
}

function selectStation(i) {
  if (i < 0 || i >= stations.length) return;
  isDjMode = false; currentDjIsLive = false;
  stopOther(audio);
  currentIdx = i;
  const s = stations[i];
  currentStreamUrl = s.url;
  currentUrl = s.url;
  setNowPlaying(s.name, s.genre);
  playUrl(audio, s.url);
  playing = true;
  updatePlayBtn();
  saveLastPlayed(i);
  renderMyList();
}

function playExternal(name, url, tag) {
  isDjMode = false; currentDjIsLive = false;
  stopOther(audio);
  currentIdx = -1;
  currentStreamUrl = url;
  currentUrl = url;
  setNowPlaying(name, tag);
  playUrl(audio, url);
  playing = true;
  updatePlayBtn();
  renderMyList();
}

function playDj(name, url, genre, isLive) {
  isDjMode = true; currentDjIsLive = isLive;
  stopOther(audioDj);
  currentIdx = -1;
  currentStreamUrl = url;
  currentUrl = url;
  setNowPlaying(name, genre);
  playUrl(audioDj, url);
  playing = true;
  updatePlayBtn();
  renderMyList();
}

function stopPlayback() {
  (isDjMode ? audioDj : audio).pause();
  playing = false;
  updatePlayBtn();
  setStatus('', 'Pausiert');
}
function startPlayback() {
  if (!currentUrl) {
    if (stations.length) selectStation(currentIdx >= 0 ? currentIdx : 0);
    return;
  }
  const el = isDjMode ? audioDj : audio;
  if (!el.src) el.src = currentUrl;
  applyVolume();
  const p = el.play();
  if (p && p.catch) p.catch(() => {});
  playing = true;
  updatePlayBtn();
  setStatus('loading', 'Verbinde…');
}
function togglePlay() {
  if (currentIdx === -1 && !playing && !currentUrl && stations.length > 0) { selectStation(0); return; }
  if (playing) stopPlayback(); else startPlayback();
}
function nextStation() { if (stations.length) selectStation((Math.max(currentIdx, 0) + 1) % stations.length); }
function prevStation() { if (stations.length) selectStation((currentIdx - 1 + stations.length) % stations.length); }

/* Audio-Element Events */
function wireAudioEvents(el, isDj) {
  el.addEventListener('playing', () => {
    if (isDj !== isDjMode) return;
    setStatus('playing', isDj ? (currentDjIsLive ? '● Live' : '▶ Läuft') : '● Live');
    playing = true; updatePlayBtn();
  });
  el.addEventListener('waiting', () => { if (isDj === isDjMode) setStatus('loading', 'Puffert…'); });
  el.addEventListener('pause',   () => { if (isDj === isDjMode) { playing = false; updatePlayBtn(); if (npStatus.textContent !== 'Pausiert' && !npStatus.className.includes('error')) setStatus('', 'Pausiert'); } });
  el.addEventListener('error',   () => {
    if (isDj !== isDjMode) return;
    playing = false; updatePlayBtn();
    // Fehlercode des Browsers mit anzeigen, damit sich die Ursache eingrenzen lässt:
    // 2 = Netzwerk/Server, 3 = Dekodierung, 4 = Format/Adresse nicht unterstützt oder blockiert
    const code = el.error ? el.error.code : '?';
    if (el.dataset.upgraded === '1') {
      setStatus('error', `Sender nur über HTTP — nicht abspielbar (Code ${code})`);
    } else {
      setStatus('error', `Fehler beim Laden (Code ${code})`);
    }
  });
}
wireAudioEvents(audio, false);
wireAudioEvents(audioDj, true);

$('mini-play').addEventListener('click', e => { e.stopPropagation(); togglePlay(); });
$('np-play').addEventListener('click', togglePlay);
$('np-prev').addEventListener('click', prevStation);
$('np-next').addEventListener('click', nextStation);
volumeEl.addEventListener('input', applyVolume);

/* ── Tabs ── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

/* ── Genre Filter (Meine Sender) ── */
function renderGenreBar() {
  const sel = $('genre-filter');
  const prev = sel.value || activeGenre || 'all';
  sel.innerHTML = '';
  const used = ['all', ...genres.filter(g => stations.some(s => s.genre === g))];
  used.forEach(g => {
    const o = document.createElement('option');
    o.value = g; o.textContent = g === 'all' ? 'Alle Genres' : g;
    sel.appendChild(o);
  });
  sel.value = used.includes(prev) ? prev : 'all';
  activeGenre = sel.value;
}
$('genre-filter').addEventListener('change', e => { activeGenre = e.target.value; renderMyList(); });

/* ── My Stations List ── */
function renderMyList() {
  const list = $('station-list');
  const filtered = stations.map((s, i) => ({ ...s, idx: i }))
    .filter(s => activeGenre === 'all' || s.genre === activeGenre);
  list.innerHTML = '';
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-msg">Keine Sender in diesem Genre.<br>Tippe oben rechts auf „+", um einen hinzuzufügen.</div>';
    return;
  }
  filtered.forEach(s => {
    const row = document.createElement('div');
    row.className = 'station' + (s.idx === currentIdx ? ' active' : '');
    row.dataset.idx = s.idx;
    row.innerHTML = `
      <div class="drag-handle" title="Zum Sortieren ziehen">
        <svg viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="2.5" r="1.3"/><circle cx="7" cy="2.5" r="1.3"/><circle cx="3" cy="7" r="1.3"/><circle cx="7" cy="7" r="1.3"/><circle cx="3" cy="11.5" r="1.3"/><circle cx="7" cy="11.5" r="1.3"/></svg>
      </div>
      <div class="station-dot"></div>
      <div class="station-info">
        <div class="station-name">${esc(s.name)}</div>
        <div class="station-sub">${esc(s.genre || '')}</div>
      </div>
      <button class="row-action edit" title="Bearbeiten" aria-label="Bearbeiten">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      </button>`;

    row.addEventListener('click', e => {
      if (e.target.closest('.row-action') || e.target.closest('.drag-handle')) return;
      selectStation(s.idx);
    });
    row.querySelector('.edit').addEventListener('click', e => { e.stopPropagation(); openEditSheet(s.idx); });

    attachDrag(row.querySelector('.drag-handle'), row, s.idx);
    list.appendChild(row);
  });
}

/* ── Drag-to-Reorder (Pointer Events, touch-tauglich) ── */
function attachDrag(handle, row, fromIdx) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    const list = $('station-list');
    let targetIdx = null, insertBefore = true;
    row.classList.add('dragging');
    row.style.pointerEvents = 'none';
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}

    const clearMarks = () => list.querySelectorAll('.station').forEach(el => el.classList.remove('drag-over-before', 'drag-over-after'));

    const onMove = ev => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.station');
      clearMarks();
      if (el && el !== row) {
        const rect = el.getBoundingClientRect();
        insertBefore = ev.clientY < rect.top + rect.height / 2;
        el.classList.add(insertBefore ? 'drag-over-before' : 'drag-over-after');
        targetIdx = parseInt(el.dataset.idx);
      } else {
        targetIdx = null;
      }
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      row.classList.remove('dragging');
      row.style.pointerEvents = '';
      clearMarks();
      if (targetIdx === null || isNaN(targetIdx) || targetIdx === fromIdx) return;
      let insertIdx = insertBefore ? targetIdx : targetIdx + 1;
      const moved = stations.splice(fromIdx, 1)[0];
      const adj = insertIdx > fromIdx ? insertIdx - 1 : insertIdx;
      stations.splice(adj, 0, moved);
      if (currentIdx === fromIdx) currentIdx = adj;
      else if (currentIdx > fromIdx && currentIdx <= adj) currentIdx--;
      else if (currentIdx < fromIdx && currentIdx >= adj) currentIdx++;
      saveData(); renderMyList();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}

/* ── Add / Edit Sheet ── */
const backdrop = $('backdrop');
const addSheet = $('add-sheet');
const nowSheet = $('now-sheet');

function openSheet(sheet) { backdrop.classList.add('on'); sheet.classList.add('on'); }
function closeSheets() {
  backdrop.classList.remove('on');
  addSheet.classList.remove('on');
  nowSheet.classList.remove('on');
}
backdrop.addEventListener('click', closeSheets);

function fillGenreSelect(sel, selected) {
  sel.innerHTML = '';
  genres.forEach(g => {
    const o = document.createElement('option');
    o.value = g; o.textContent = g;
    if (g === selected) o.selected = true;
    sel.appendChild(o);
  });
}

function openAddSheet() {
  editingIdx = -1;
  $('add-title').textContent = 'Sender hinzufügen';
  $('add-submit').textContent = 'Hinzufügen';
  $('edit-delete-row').style.display = 'none';
  const f = $('add-form');
  f.reset();
  fillGenreSelect($('add-genre'), '');
  openSheet(addSheet);
}
function openEditSheet(idx) {
  editingIdx = idx;
  const s = stations[idx];
  $('add-title').textContent = 'Sender bearbeiten';
  $('add-submit').textContent = 'Speichern';
  $('edit-delete-row').style.display = 'flex';
  const f = $('add-form');
  f.elements.name.value = s.name || '';
  f.elements.url.value = s.url || '';
  f.elements.newgenre.value = '';
  fillGenreSelect($('add-genre'), s.genre);
  openSheet(addSheet);
}

$('add-open').addEventListener('click', openAddSheet);
$('add-cancel').addEventListener('click', closeSheets);

$('add-form').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const name = f.elements.name.value.trim();
  const url  = f.elements.url.value.trim();
  const newg = f.elements.newgenre.value.trim();
  let genre  = f.elements.genre.value;
  if (!name || !url) return;
  if (newg) { genre = newg; if (!genres.includes(genre)) genres.push(genre); }

  if (editingIdx >= 0) {
    stations[editingIdx].name = name;
    stations[editingIdx].url = url;
    stations[editingIdx].genre = genre;
    toast('Gespeichert');
  } else {
    stations.push({ name, url, genre });
    toast('Sender hinzugefügt');
  }
  saveData(); renderGenreBar(); renderMyList();
  const addedIdx = editingIdx >= 0 ? editingIdx : stations.length - 1;
  closeSheets();
  if (editingIdx < 0) selectStation(addedIdx);
  editingIdx = -1;
});

$('edit-delete').addEventListener('click', () => {
  if (editingIdx < 0) return;
  const idx = editingIdx;
  if (idx === currentIdx) {
    audio.pause(); audio.src = ''; playing = false; currentIdx = -1; currentUrl = '';
    setNowPlaying('', ''); setStatus('', '–'); updatePlayBtn();
  } else if (idx < currentIdx) currentIdx--;
  stations.splice(idx, 1);
  saveData(); renderGenreBar(); renderMyList();
  closeSheets();
  editingIdx = -1;
  toast('Sender gelöscht');
});

/* ── Now Playing Sheet öffnen ── */
nowBar.addEventListener('click', () => openSheet(nowSheet));

/* ============================================================
   ENTDECKEN
   ============================================================ */
const GENRES = [
  { label: 'Alle',        tag: ''           },
  { label: 'Top',         tag: '__top__'    },
  { label: 'DJ Sets',     tag: '__djsets__' },
  { label: 'Electronic',  tag: 'electronic' },
  { label: 'Techno',      tag: 'techno'     },
  { label: 'House',       tag: 'house'      },
  { label: 'Ambient',     tag: 'ambient'    },
  { label: 'Jazz',        tag: 'jazz'       },
  { label: 'Blues',       tag: 'blues'      },
  { label: 'Soul / Funk', tag: 'soul'       },
  { label: 'Klassik',     tag: 'classical'  },
  { label: 'Pop',         tag: 'pop'        },
  { label: 'Rock',        tag: 'rock'       },
  { label: 'Metal',       tag: 'metal'      },
  { label: 'Hip-Hop',     tag: 'hip-hop'    },
  { label: 'Reggae',      tag: 'reggae'     },
  { label: 'Dance',       tag: 'dance'      },
  { label: 'Folk',        tag: 'folk'       },
  { label: 'Country',     tag: 'country'    },
  { label: 'News',        tag: 'news'       },
  { label: 'Sport',       tag: 'sports'     },
];

const DJ_GENRES = [
  { id: '',                 label: 'Beliebt' },
  { id: 'livestreams',      label: '🔴 Live jetzt' },
  { id: 'house',            label: 'House' },
  { id: 'techhouse',        label: 'Tech House' },
  { id: 'deephouse',        label: 'Deep House' },
  { id: 'progressivehouse', label: 'Progressive House' },
  { id: 'organichouse',     label: 'Organic House' },
  { id: 'techno',           label: 'Techno' },
  { id: 'dubtechno',        label: 'Dub Techno' },
  { id: 'trance',           label: 'Trance' },
  { id: 'psytrance',        label: 'Psytrance' },
  { id: 'drumandbass',      label: 'Drum & Bass' },
  { id: 'dubstep',          label: 'Dubstep' },
  { id: 'electro',          label: 'Electro' },
  { id: 'edm',              label: 'EDM' },
  { id: 'ambient',          label: 'Ambient' },
  { id: 'downtempo',        label: 'Downtempo' },
  { id: 'lofi',             label: 'Lo-Fi' },
  { id: 'disco',            label: 'Disco' },
  { id: 'funk',             label: 'Funk' },
  { id: 'soul',             label: 'Soul' },
  { id: 'hiphop',           label: 'Hip Hop' },
  { id: 'trap',             label: 'Trap' },
  { id: 'raggae',           label: 'Reggae' },
  { id: 'dub',              label: 'Dub' },
  { id: 'jazz',             label: 'Jazz' },
  { id: 'classical',        label: 'Klassik' },
];

let activeDiscoverTag = '';

function populateDjGenres() {
  const sel = $('f-djgenre');
  if (sel.options.length) return;
  DJ_GENRES.forEach(g => { const o = document.createElement('option'); o.value = g.id; o.textContent = g.label; sel.appendChild(o); });
}

function renderGenreChips() {
  const wrap = $('genre-chips');
  wrap.innerHTML = '';
  GENRES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'chip' + (g.tag === activeDiscoverTag ? ' active' : '');
    btn.textContent = g.label;
    btn.addEventListener('click', () => {
      activeDiscoverTag = g.tag;
      renderGenreChips();
      const isDj = activeDiscoverTag === '__djsets__';
      $('f-country').style.display = isDj ? 'none' : '';
      $('f-djgenre').style.display = isDj ? '' : 'none';
      $('dj-hint').style.display = isDj ? 'block' : 'none';
      $('f-network').placeholder = isDj ? 'DJ suchen…' : 'Sender / Netzwerk suchen…';
      if (isDj) populateDjGenres(); else updateCountryList();
      searchStations();
    });
    wrap.appendChild(btn);
  });
}

async function updateCountryList() {
  const cSel = $('f-country');
  const current = cSel.value;
  cSel.innerHTML = '<option value="">🌍 Alle Länder</option>';
  try {
    if (!activeDiscoverTag || activeDiscoverTag === '__top__') {
      const countries = await radioApi('countries?hidebroken=true&order=name&limit=300');
      countries.filter(c => c.stationcount > 0).forEach(c => {
        const o = document.createElement('option');
        o.value = c.iso_3166_1;
        o.textContent = `${c.name} (${c.stationcount})`;
        if (c.iso_3166_1 === current) o.selected = true;
        cSel.appendChild(o);
      });
    } else {
      const sts = await radioApi(`stations/search?tag=${encodeURIComponent(activeDiscoverTag)}&hidebroken=true&limit=3000`);
      const counts = {}, names = {};
      sts.forEach(s => {
        if (!s.countrycode) return;
        counts[s.countrycode] = (counts[s.countrycode] || 0) + 1;
        if (s.country) names[s.countrycode] = s.country;
      });
      Object.entries(counts)
        .sort((a, b) => (names[a[0]] || '').localeCompare(names[b[0]] || ''))
        .forEach(([code, count]) => {
          const o = document.createElement('option');
          o.value = code;
          o.textContent = `${names[code] || code} (${count})`;
          if (code === current) o.selected = true;
          cSel.appendChild(o);
        });
    }
  } catch (e) {}
}

async function searchStations() {
  const btn = $('search-btn');
  const network = $('f-network').value.trim();
  const statusD = $('discover-status');
  const list = $('discover-list');

  btn.disabled = true; btn.textContent = '…';
  statusD.textContent = '';
  list.innerHTML = '<div class="empty-msg">Lade…</div>';

  if (activeDiscoverTag === '__djsets__') {
    await searchDjSets(network);
    btn.disabled = false; btn.textContent = 'Suchen';
    return;
  }

  const country = $('f-country').value;
  const isTop = activeDiscoverTag === '__top__';
  const params = new URLSearchParams({ hidebroken: 'true', order: 'votes', reverse: 'true', limit: '80' });
  // Nur Sender, die über HTTPS senden — alles andere blockiert der Browser.
  if (PAGE_IS_HTTPS) params.set('is_https', 'true');
  if (country) params.set('countrycode', country);
  if (activeDiscoverTag && !isTop) params.set('tag', activeDiscoverTag);
  if (network) params.set('name', network);

  try {
    const results = await radioApi(`stations/search?${params}`);
    btn.disabled = false; btn.textContent = 'Suchen';
    renderDiscoverList(results);
    statusD.textContent = results.length ? `${results.length} Sender` : 'Keine Sender gefunden';
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Suchen';
    list.innerHTML = '<div class="empty-msg">Verbindungsfehler.<br>Bitte Internetverbindung prüfen und erneut versuchen.</div>';
  }
}

function renderDiscoverList(results) {
  const list = $('discover-list');
  list.innerHTML = '';
  if (!results.length) { list.innerHTML = '<div class="empty-msg">Keine Sender gefunden</div>'; return; }

  results.forEach(r => {
    if (!r.url_resolved && !r.url) return;
    const cands = [r.url_resolved, r.url].filter(Boolean);
    const url = cands.find(u => /^https:/i.test(u)) || cands[0];
    const genreLabel = GENRES.find(g => g.tag === activeDiscoverTag)?.label
      || (r.tags ? r.tags.split(',')[0].trim() : '');
    const isActive = currentStreamUrl === url;

    const div = document.createElement('div');
    div.className = 'station' + (isActive ? ' active' : '');
    div.innerHTML = `
      <div class="station-dot"></div>
      <div class="station-info">
        <div class="station-name">${esc(r.name)}</div>
        <div class="station-sub">${esc(r.country || '')}${r.country && genreLabel ? ' · ' : ''}${esc(genreLabel)}</div>
      </div>
      <button class="row-action add" title="Zu meinen Sendern" aria-label="Hinzufügen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>`;
    div.addEventListener('click', e => {
      if (e.target.closest('.row-action')) return;
      playExternal(r.name, url, genreLabel);
      document.querySelectorAll('#discover-list .station').forEach(el => el.classList.remove('active'));
      div.classList.add('active');
    });
    div.querySelector('.add').addEventListener('click', e => {
      e.stopPropagation();
      if (!stations.some(s => s.url === url)) {
        if (genreLabel && !genres.includes(genreLabel)) genres.push(genreLabel);
        stations.push({ name: r.name, url, genre: genreLabel });
        saveData(); renderGenreBar(); renderMyList();
        toast('Zu „Meine Sender" hinzugefügt');
      } else {
        toast('Schon in deiner Liste');
      }
      const b = div.querySelector('.add');
      b.classList.add('added');
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    });
    list.appendChild(div);
  });
}

function formatDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

async function searchDjSets(query) {
  const statusD = $('discover-status');
  const list = $('discover-list');
  const genre = $('f-djgenre').value;
  try {
    let path;
    if (query) {
      path = `search/?t=${encodeURIComponent(query)}${genre && genre !== 'livestreams' ? `&category=${genre}` : ''}&page=1&count=40`;
    } else if (genre === 'livestreams') {
      path = `categories/livestreams/?page=1&count=40`;
    } else if (genre) {
      path = `feed/?type=popular&category=${genre}&page=1&count=40`;
    } else {
      path = `feed/?type=popular&page=1&count=40`;
    }
    const results = await hearthisApi(path);
    if (!Array.isArray(results) || !results.length) {
      list.innerHTML = '<div class="empty-msg">Keine DJ Sets gefunden</div>';
      statusD.textContent = '';
      return;
    }
    const isLive = genre === 'livestreams';
    list.innerHTML = '';
    results.forEach(r => {
      if (!r.stream_url) return;
      const isActive = currentStreamUrl === r.stream_url;
      const duration = isLive ? '🔴 LIVE' : (r.duration ? formatDuration(parseInt(r.duration)) : '');
      const g = r.genre || r.tag_list || '';
      const div = document.createElement('div');
      div.className = 'station' + (isActive ? ' active' : '');
      div.innerHTML = `
        <div class="station-dot"></div>
        <div class="station-info">
          <div class="station-name">${esc(r.title || r.user?.username || '–')}</div>
          <div class="station-sub">${esc(r.user?.username || '')}${r.user?.username && (duration || g) ? ' · ' : ''}${esc(duration)}${duration && g ? ' · ' : ''}${esc(g)}</div>
        </div>
        <button class="row-action add" title="Zu meinen Sendern" aria-label="Hinzufügen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>`;
      div.addEventListener('click', e => {
        if (e.target.closest('.row-action')) return;
        document.querySelectorAll('#discover-list .station').forEach(el => el.classList.remove('active'));
        div.classList.add('active');
        playDj(r.title || r.user?.username || '–', r.stream_url, g, isLive);
      });
      div.querySelector('.add').addEventListener('click', e => {
        e.stopPropagation();
        const name = r.title || r.user?.username || 'DJ Set';
        if (!stations.some(s => s.url === r.stream_url)) {
          stations.push({ name, url: r.stream_url, genre: g || 'DJ Set' });
          saveData(); renderGenreBar(); renderMyList();
          toast('Zu „Meine Sender" hinzugefügt');
        } else { toast('Schon in deiner Liste'); }
        const b = div.querySelector('.add');
        b.classList.add('added');
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
      });
      list.appendChild(div);
    });
    statusD.textContent = `${results.length} DJ Sets`;
  } catch (e) {
    list.innerHTML = '<div class="empty-msg">hearthis.at ist im Browser leider nicht direkt erreichbar (CORS).<br>DJ Sets funktionieren derzeit nur in der Desktop-App.</div>';
    statusD.textContent = '';
  }
}

$('search-btn').addEventListener('click', searchStations);
$('f-network').addEventListener('keydown', e => { if (e.key === 'Enter') { e.target.blur(); searchStations(); } });
$('f-country').addEventListener('change', searchStations);
$('f-djgenre').addEventListener('change', searchStations);

/* ── Keyboard (optional, für BT-Tastaturen) ── */
document.addEventListener('keydown', e => {
  const t = e.target.tagName;
  if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.code === 'ArrowRight' || e.code === 'ArrowDown') { e.preventDefault(); nextStation(); }
  else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') { e.preventDefault(); prevStation(); }
});

/* ── Toast ── */
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 1900);
}

/* ── Install Hint (iOS) ── */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
});
function maybeShowIosInstallHint() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isIOS && !standalone) {
    let dismissed = false;
    try { dismissed = localStorage.getItem('ios_install_dismissed') === '1'; } catch (e) {}
    if (!dismissed) setTimeout(() => $('install-hint').classList.add('on'), 2500);
  }
}
$('ih-close').addEventListener('click', () => {
  $('install-hint').classList.remove('on');
  try { localStorage.setItem('ios_install_dismissed', '1'); } catch (e) {}
});

/* ── Volume-Hinweis iOS ── */
if (isIOS) {
  $('vol-note').textContent = 'Auf dem iPhone wird die Lautstärke über die Hardware-Tasten geregelt.';
}

/* ── Service Worker ── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ── Init ── */
loadData();
renderGenreBar();
renderMyList();
setupMediaSession();
renderGenreChips();
updateCountryList().then(searchStations);
applyVolume();
maybeShowIosInstallHint();

// Zuletzt gespielten Sender wiederherstellen (nur anzeigen, nicht autoplay —
// Browser blockieren Autoplay ohne Nutzerinteraktion).
try {
  const lastIdx = parseInt(localStorage.getItem('radio_last') ?? '-1');
  if (lastIdx >= 0 && lastIdx < stations.length) {
    currentIdx = lastIdx;
    const s = stations[lastIdx];
    currentUrl = s.url;
    currentStreamUrl = s.url;
    setNowPlaying(s.name, s.genre);
    setStatus('', 'Bereit — tippe ▶');
    updatePlayBtn();
    renderMyList();
  }
} catch (e) {}
