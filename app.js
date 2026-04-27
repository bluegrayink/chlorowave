// ============================================================
//  CHLOROWAVE — app.js
//  Features: Cover Art (MusicBrainz), Shuffle, Repeat, Mini Player
// ============================================================

const CONFIG = {
    GOOGLE_CLIENT_ID:    '721053641807-k0be448jbrkhd3cu9e5iuj6l7vv3nh0g.apps.googleusercontent.com',
    GAS_ENDPOINT:        'https://script.google.com/macros/s/AKfycbwccnydHu5Q6H1zvKN_awF_4Np4JtDSmc1GXSYSvBEYIqoXiBK9ZpkIhcJAF0Qv-bGCNg/exec',
    FOLDER_NAME:         'chlorowave',
    TEMANQRIS_MERCHANT:  'MQ4F26C50380',
    TEMANQRIS_AMOUNT:    20000,
};

// ============================================================
//  STATE GLOBAL
// ============================================================
let accessToken  = null;
let userEmail    = null;
let playlist     = [];
let playlists    = {};
let currentIdx   = -1;
let shuffleMode  = false;
let repeatMode   = 'none'; // 'none' | 'all' | 'one'
let shuffledIdxs = [];
let audioCtx     = null;
let analyser     = null;
let sourceNode   = null;
let animFrameId  = null;
let coverCache   = {}; // cache cover art per song name

// ============================================================
//  SCREEN NAVIGATION
// ============================================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// ============================================================
//  SESSION MANAGEMENT - persist 6 jam
// ============================================================
const SESSION_DURATION = 6 * 60 * 60 * 1000;

function saveSession(token, email) {
    sessionStorage.setItem('cw_session', JSON.stringify({ token, email, loginAt: Date.now() }));
}

function loadSession() {
    try {
        const raw = sessionStorage.getItem('cw_session');
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (Date.now() - session.loginAt > SESSION_DURATION) {
            sessionStorage.removeItem('cw_session');
            return null;
        }
        return session;
    } catch { return null; }
}

function clearSession() { sessionStorage.removeItem('cw_session'); }

function touchSession() {
    try {
        const raw = sessionStorage.getItem('cw_session');
        if (!raw) return;
        const session = JSON.parse(raw);
        session.loginAt = Date.now();
        sessionStorage.setItem('cw_session', JSON.stringify(session));
    } catch {}
}

document.addEventListener('click', touchSession);

// ============================================================
//  INIT
// ============================================================
window.addEventListener('load', async () => {
    const session = loadSession();

    if (session && session.token && session.email) {
        accessToken = session.token;
        userEmail   = session.email;
        updateUsernameUI();
        showScreen('screen-app');
        fetchSongsFromDrive();
        return;
    }

    const status = localStorage.getItem('cw_status');
    const email  = localStorage.getItem('cw_email');
    if (status === 'pending' && email) {
        document.getElementById('pending-email-display').textContent = email;
        showScreen('screen-pending');
    } else {
        showScreen('screen-landing');
    }
});

// ============================================================
//  REGISTRASI
// ============================================================
// Simpan data registrasi sementara
let regData = { email: '', shareUrl: '' };

document.getElementById('reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl     = document.getElementById('reg-error');
    const btnText   = document.getElementById('reg-btn-text');
    const btnLoad   = document.getElementById('reg-btn-loader');
    const submitBtn = document.getElementById('reg-submit-btn');

    const prefix   = document.getElementById('f-email').value.trim().toLowerCase().replace(/@.*/, '');
    const email    = prefix + '@gmail.com';
    const shareUrl = document.getElementById('f-share').value.trim();

    if (!prefix) { showError(errEl, 'Masukkan nama akun Gmail kamu'); return; }
    if (!shareUrl) { showError(errEl, 'Masukkan link share sosmed kamu'); return; }

    btnText.textContent = 'Memproses...';
    btnLoad.classList.remove('hidden');
    submitBtn.disabled = true;
    errEl.classList.add('hidden');

    try {
        // Simpan data ke GAS dulu dengan status 'waiting_payment'
        const url  = `${CONFIG.GAS_ENDPOINT}?action=register&email=${encodeURIComponent(email)}&shareUrl=${encodeURIComponent(shareUrl)}&refNum=QRIS-PENDING`;
        const res  = await fetch(url);
        const data = await res.json();
        if (!data.ok) throw new Error('Server menolak data');

        // Simpan sementara untuk dipakai di QR
        regData = { email, shareUrl };
        localStorage.setItem('cw_reg_email',    email);
        localStorage.setItem('cw_reg_shareUrl', shareUrl);

        // Pindah ke step 2 — tampilkan QR
        showRegStep(2);
        initTemanqrisWidget(email);

    } catch (err) {
        showError(errEl, 'Gagal memproses. Coba lagi beberapa saat.');
    } finally {
        btnText.textContent = 'Lanjut ke Pembayaran';
        btnLoad.classList.add('hidden');
        submitBtn.disabled = false;
    }
});

function showRegStep(step) {
    document.getElementById('reg-step-1').classList.toggle('hidden', step !== 1);
    document.getElementById('reg-step-2').classList.toggle('hidden', step !== 2);
}

function backToStep1() {
    showRegStep(1);
    document.getElementById('qr-widget-container').innerHTML = '';
}

function initTemanqrisWidget(email) {
    const container = document.getElementById('qr-widget-container');
    container.innerHTML = '';

    // Buat script tag Temanqris widget dinamis
    const script = document.createElement('script');
    script.src = 'https://temanqris.com/widget.js';
    script.setAttribute('data-merchant',     CONFIG.TEMANQRIS_MERCHANT);
    script.setAttribute('data-amount',       CONFIG.TEMANQRIS_AMOUNT);
    script.setAttribute('data-button-text',  'Bayar dengan QRIS');
    script.setAttribute('data-button-color', '#1DB954');
    script.setAttribute('data-description',  `ChloroWave-${email}`);
    script.setAttribute('data-callback',     `${window.location.origin}${window.location.pathname}?payment=success&email=${encodeURIComponent(email)}`);
    script.setAttribute('data-webhook',      `${CONFIG.GAS_ENDPOINT}?action=paymentWebhook`);
    container.appendChild(script);
}

// Cek apakah callback dari payment berhasil
window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
        const email = params.get('email');
        if (email) {
            localStorage.setItem('cw_status', 'pending');
            localStorage.setItem('cw_email',  email);
            // Bersihkan URL
            window.history.replaceState({}, '', window.location.pathname);
        }
    }
});

function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }

// ============================================================
//  LOGIN
// ============================================================
function tryLogin() {
    if (typeof google === 'undefined') {
        alert('Koneksi internet diperlukan. Coba muat ulang halaman.');
        return;
    }
    const client = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        scope: [
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email'
        ].join(' '),
        callback: async (response) => {
            if (response.error) return;
            accessToken = response.access_token;
            await handlePostLogin();
        },
    });
    client.requestAccessToken();
}

async function handlePostLogin() {
    try {
        const res  = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const user = await res.json();
        userEmail  = user.email;
        const isWhitelisted = await checkWhitelist(userEmail);
        if (isWhitelisted) {
            onLoginSuccess(user);
        } else {
            document.getElementById('denied-email').textContent = userEmail;
            openModal('modal-denied');
            accessToken = null; userEmail = null;
        }
    } catch (err) {
        alert('Terjadi kesalahan saat login. Coba lagi.');
    }
}

async function checkWhitelist(email) {
    try {
        const res  = await fetch(`${CONFIG.GAS_ENDPOINT}?action=checkWhitelist&email=${encodeURIComponent(email)}`);
        const data = await res.json();
        return data.active === true;
    } catch { return false; }
}

function onLoginSuccess(user) {
    if (!localStorage.getItem('cw_username')) {
        localStorage.setItem('cw_username', user.given_name || user.email.split('@')[0]);
    }
    localStorage.setItem('cw_status', 'active');
    localStorage.setItem('cw_email',  userEmail);
    // Simpan session agar tidak login ulang saat refresh
    saveSession(accessToken, userEmail);
    updateUsernameUI();
    showScreen('screen-app');
    fetchSongsFromDrive();
}

// ============================================================
//  USER PROFILE
// ============================================================
function updateUsernameUI() {
    const name = localStorage.getItem('cw_username') || userEmail?.split('@')[0] || 'User';
    document.getElementById('username-display').textContent = '👤 ' + name;
}

function toggleUserMenu() { document.getElementById('user-menu').classList.toggle('hidden'); }

document.addEventListener('click', (e) => {
    const menu    = document.getElementById('user-menu');
    const profile = document.getElementById('user-profile');
    if (menu && !profile?.contains(e.target)) menu.classList.add('hidden');
});

function saveUsername() {
    const val = document.getElementById('edit-username-input').value.trim();
    if (val) {
        localStorage.setItem('cw_username', val);
        updateUsernameUI();
        document.getElementById('edit-username-input').value = '';
        document.getElementById('user-menu').classList.add('hidden');
    }
}

function logout() {
    if (confirm('Yakin mau logout?')) {
        accessToken = null; userEmail = null; playlist = []; playlists = {}; currentIdx = -1;
        clearSession();
        stopVisualizer();
        hideMiniPlayer();
        showScreen('screen-landing');
    }
}

function resetPending() {
    if (confirm('Data pendaftaran sebelumnya akan dihapus. Lanjut?')) {
        localStorage.removeItem('cw_status');
        localStorage.removeItem('cw_email');
        showScreen('screen-register');
    }
}

function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ============================================================
//  GOOGLE DRIVE
// ============================================================
async function fetchSongsFromDrive() {
    const listEl = document.getElementById('playlist-ui');
    listEl.innerHTML = '<li class="playlist-loading">Mencari folder chlorowave...</li>';
    document.getElementById('song-count').textContent = '';

    try {
        const folderQuery = encodeURIComponent(`name='${CONFIG.FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
        const folderRes   = await fetch(`https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=files(id,name)`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const folderData  = await folderRes.json();

        if (!folderData.files || folderData.files.length === 0) {
            listEl.innerHTML = `
                <li class="folder-not-found">
                    <div class="fnf-icon"><i class="fa-solid fa-folder-open"></i></div>
                    <div class="fnf-title">Folder tidak ditemukan</div>
                    <div class="fnf-desc">Buat folder <code>chlorowave</code> di Google Drive kamu, lalu upload lagu ke dalamnya.</div>
                    <div class="fnf-steps">
                        <div class="fnf-step"><span class="fnf-num">1</span><span>Buka <a href="https://drive.google.com" target="_blank">Google Drive</a></span></div>
                        <div class="fnf-step"><span class="fnf-num">2</span><span>Klik <strong>+ New</strong> → <strong>Folder</strong></span></div>
                        <div class="fnf-step"><span class="fnf-num">3</span><span>Beri nama persis: <code>chlorowave</code></span></div>
                        <div class="fnf-step"><span class="fnf-num">4</span><span>Upload lagu ke folder tersebut</span></div>
                        <div class="fnf-step"><span class="fnf-num">5</span><span>Klik tombol <strong>Refresh</strong> di atas</span></div>
                    </div>
                </li>`;
            return;
        }

        const rootFolderId = folderData.files[0].id;
        await loadFolderContents(rootFolderId);

        const totalSongs = playlist.length;
        document.getElementById('song-count').textContent = `${totalSongs} lagu`;

        if (totalSongs === 0) {
            listEl.innerHTML = '<li class="playlist-empty">Folder chlorowave kosong. Upload lagu dulu!</li>';
            return;
        }

        renderPlaylist();
        setupMediaSession();

    } catch (err) {
        document.getElementById('playlist-ui').innerHTML = `<li class="playlist-error">Gagal memuat: ${err.message}</li>`;
    }
}

async function loadFolderContents(folderId) {
    playlist  = [];
    playlists = {};

    const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res   = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType)&pageSize=200&orderBy=name`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data  = await res.json();
    if (!data.files) return;

    const rootSongs  = [];
    const subfolders = [];

    for (const file of data.files) {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
            subfolders.push(file);
        } else if (isAudioFile(file)) {
            rootSongs.push(file);
        }
    }

    for (const song of rootSongs) {
        playlist.push({ ...song, playlistName: null });
    }

    for (const folder of subfolders) {
        const subRes  = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folder.id}' in parents and trashed=false`)}&fields=files(id,name,mimeType)&pageSize=200&orderBy=name`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const subData = await subRes.json();
        if (!subData.files) continue;
        const subSongs = subData.files.filter(f => isAudioFile(f));
        if (subSongs.length === 0) continue;
        playlists[folder.name] = [];
        for (const song of subSongs) {
            const entry = { ...song, playlistName: folder.name };
            playlist.push(entry);
            playlists[folder.name].push(entry);
        }
    }

    // Build shuffle index
    rebuildShuffleIdxs();
}

function isAudioFile(file) {
    if (file.mimeType && file.mimeType.startsWith('audio/')) return true;
    return /\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|aiff|ape|mp4)$/i.test(file.name);
}

// ============================================================
//  RENDER PLAYLIST
// ============================================================
function renderPlaylist() {
    const listEl = document.getElementById('playlist-ui');
    let html     = '';

    const rootSongs = playlist.filter(s => s.playlistName === null);
    for (const song of rootSongs) {
        const i = playlist.indexOf(song);
        html += trackHTML(i, song);
    }

    for (const [folderName, songs] of Object.entries(playlists)) {
        html += `<li class="playlist-header">${sanitize(folderName)} <span class="playlist-count">${songs.length} lagu</span></li>`;
        for (const song of songs) {
            const i = playlist.indexOf(song);
            html += trackHTML(i, song);
        }
    }

    listEl.innerHTML = html || '<li class="playlist-empty">Tidak ada lagu.</li>';
}

function trackHTML(idx, song) {
    const name   = song.name.replace(/\.[^.]+$/, '');
    const parsed = parseSongName(name);
    const colors = gradientColors(name);
    return `
        <li id="track-${idx}" onclick="playSong(${idx})">
            <div class="track-thumb" id="thumb-${idx}" style="background:linear-gradient(135deg,${colors[0]},${colors[1]})">
                <span class="track-thumb-initial">${parsed.artist ? parsed.artist[0].toUpperCase() : name[0].toUpperCase()}</span>
            </div>
            <div class="track-info">
                <span class="track-name">${sanitize(parsed.title || name)}</span>
                ${parsed.artist ? `<span class="track-artist">${sanitize(parsed.artist)}</span>` : ''}
            </div>
            <span class="track-icon" id="bar-${idx}">♪</span>
        </li>`;
}

// ============================================================
//  COVER ART — MusicBrainz + Cover Art Archive
// ============================================================
function parseSongName(filename) {
    // Format: "Artist - Title" atau "Title"
    const match = filename.match(/^(.+?)\s*[-–]\s*(.+)$/);
    if (match) return { artist: match[1].trim(), title: match[2].trim() };
    return { artist: null, title: filename };
}

function gradientColors(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const hue1 = Math.abs(hash) % 360;
    const hue2 = (hue1 + 40) % 360;
    return [`hsl(${hue1},60%,35%)`, `hsl(${hue2},60%,25%)`];
}

async function fetchCoverArt(songName) {
    if (coverCache[songName]) return coverCache[songName];

    const parsed = parseSongName(songName);
    const query  = parsed.artist
        ? `recording:"${parsed.title}" AND artist:"${parsed.artist}"`
        : `recording:"${parsed.title}"`;

    try {
        // 1. Cari di MusicBrainz
        const mbRes  = await fetch(
            `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&limit=1&fmt=json`,
            { headers: { 'User-Agent': 'ChloroWave/1.0 (cs.chlorowave@gmail.com)' } }
        );
        const mbData = await mbRes.json();

        if (!mbData.recordings || mbData.recordings.length === 0) return null;

        const recording = mbData.recordings[0];
        const releaseId = recording.releases?.[0]?.id;
        if (!releaseId) return null;

        // 2. Ambil cover dari Cover Art Archive
        const caRes = await fetch(`https://coverartarchive.org/release/${releaseId}/front-250`);
        if (!caRes.ok) return null;

        const url = caRes.url;
        coverCache[songName] = url;
        return url;

    } catch {
        return null;
    }
}

async function updateCoverArt(songName, idx) {
    // Update cover di player utama
    const playerCover = document.getElementById('player-cover');
    const playerInit  = document.getElementById('player-cover-initial');
    const parsed      = parseSongName(songName);
    const colors      = gradientColors(songName);

    // Set gradient dulu (instant)
    playerCover.style.background = `linear-gradient(135deg,${colors[0]},${colors[1]})`;
    if (playerInit) playerInit.textContent = parsed.artist ? parsed.artist[0].toUpperCase() : songName[0].toUpperCase();

    // Fetch cover art async
    const coverUrl = await fetchCoverArt(songName);
    if (coverUrl) {
        playerCover.style.backgroundImage = `url('${coverUrl}')`;
        playerCover.style.backgroundSize  = 'cover';
        playerCover.style.backgroundPosition = 'center';

        // Update thumb di playlist juga
        const thumb = document.getElementById(`thumb-${idx}`);
        if (thumb) {
            thumb.style.backgroundImage    = `url('${coverUrl}')`;
            thumb.style.backgroundSize     = 'cover';
            thumb.style.backgroundPosition = 'center';
            const initial = thumb.querySelector('.track-thumb-initial');
            if (initial) initial.style.display = 'none';
        }

        // Update mini player
        const miniCover = document.getElementById('mini-cover');
        if (miniCover) {
            miniCover.style.backgroundImage    = `url('${coverUrl}')`;
            miniCover.style.backgroundSize     = 'cover';
            miniCover.style.backgroundPosition = 'center';
            miniCover.textContent = '';
        }

        // Update notifikasi cover
        updateMediaSessionCover(coverUrl);
    }
}

// ============================================================
//  SHUFFLE & REPEAT
// ============================================================
let shuffleQueue    = []; // lagu yang belum diputar di shuffle saat ini
let shufflePlayed   = []; // lagu yang sudah diputar di shuffle ini

function rebuildShuffleIdxs() {
    // Fisher-Yates shuffle — semua lagu masuk queue dulu
    shuffleQueue  = [...Array(playlist.length).keys()];
    shufflePlayed = [];
    // Keluarkan lagu yang sedang diputar dari queue, taruh di played
    if (currentIdx >= 0) {
        shuffleQueue  = shuffleQueue.filter(i => i !== currentIdx);
        shufflePlayed = [currentIdx];
    }
    // Shuffle queue
    for (let i = shuffleQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffleQueue[i], shuffleQueue[j]] = [shuffleQueue[j], shuffleQueue[i]];
    }
    shuffledIdxs = currentIdx >= 0 ? [currentIdx, ...shuffleQueue] : [...shuffleQueue];
}

function toggleShuffle() {
    shuffleMode = !shuffleMode;
    if (shuffleMode) rebuildShuffleIdxs();
    const btn = document.getElementById('shuffle-btn');
    if (btn) btn.classList.toggle('ctrl-active', shuffleMode);
}

// ============================================================
//  REFRESH PLAYLIST
// ============================================================
function refreshPlaylist() {
    location.reload();
}

function toggleRepeat() {
    const modes = ['none', 'all', 'one'];
    repeatMode  = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
    updateRepeatBtn();
}

function updateRepeatBtn() {
    const btn    = document.getElementById('repeat-btn');
    const active = repeatMode !== 'none';
    if (btn) {
        btn.classList.toggle('ctrl-active', active);
        btn.title = repeatMode === 'none' ? 'Repeat: Off' : repeatMode === 'all' ? 'Repeat: All' : 'Repeat: One';
        const label = btn.querySelector('.repeat-label');
        if (label) label.textContent = repeatMode === 'one' ? '1' : '';
    }
}

function getNextIdx() {
    if (shuffleMode) {
        // Pindahkan currentIdx ke played
        if (!shufflePlayed.includes(currentIdx)) shufflePlayed.push(currentIdx);
        shuffleQueue = shuffleQueue.filter(i => i !== currentIdx);

        if (shuffleQueue.length === 0) {
            // Semua lagu sudah diputar — shuffle ulang dari awal
            rebuildShuffleIdxs();
        }
        return shuffleQueue[0];
    }
    return currentIdx >= playlist.length - 1 ? 0 : currentIdx + 1;
}

function getPrevIdx() {
    if (shuffleMode) {
        // Kembali ke lagu sebelumnya dari history played
        if (shufflePlayed.length > 1) {
            const prev = shufflePlayed[shufflePlayed.length - 2];
            shufflePlayed.pop();
            shuffleQueue.unshift(currentIdx);
            return prev;
        }
        return currentIdx;
    }
    return currentIdx <= 0 ? playlist.length - 1 : currentIdx - 1;
}

// ============================================================
//  PLAYER
// ============================================================
async function playSong(idx) {
    if (idx < 0 || idx >= playlist.length) return;

    currentIdx = idx;
    const file   = playlist[idx];
    const songEl = document.getElementById('current-song');
    const player = document.getElementById('audio-player');
    const parsed = parseSongName(file.name.replace(/\.[^.]+$/, ''));

    // Update active track
    document.querySelectorAll('#playlist-ui li.track-active').forEach(li => {
        li.classList.remove('track-active');
        const bar = li.querySelector('.track-icon');
        if (bar) { bar.innerHTML = '♪'; bar.classList.remove('playing'); }
    });

    const trackEl = document.getElementById(`track-${idx}`);
    if (trackEl) {
        trackEl.classList.add('track-active');
        trackEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const displayName = parsed.title || file.name.replace(/\.[^.]+$/, '');
    songEl.textContent = '⏳ Memuat...';

    // Update player info
    document.getElementById('player-title').textContent  = displayName;
    document.getElementById('player-artist').textContent = parsed.artist || 'ChloroWave';

    // Update mini player info
    const miniTitle  = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    if (miniTitle)  miniTitle.textContent  = displayName;
    if (miniArtist) miniArtist.textContent = parsed.artist || 'ChloroWave';

    try {
        const res  = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        const prev = player.src;
        player.src = URL.createObjectURL(blob);
        await player.play();

        songEl.textContent = displayName;
        showMiniPlayer();
        startVisualizer(idx);
        updateMediaSession(displayName, parsed.artist || 'ChloroWave', file.playlistName);

        // Fetch cover art async (tidak block playback)
        updateCoverArt(file.name.replace(/\.[^.]+$/, ''), idx);

        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);

    } catch (err) {
        songEl.textContent = '⚠ Gagal memutar: ' + file.name;
    }
}

function prevSong() { if (playlist.length) playSong(getPrevIdx()); }
function nextSong() { if (playlist.length) playSong(getNextIdx()); }

// ============================================================
//  CUSTOM PLAYER CONTROLS
// ============================================================
function togglePlay() {
    const player = document.getElementById('audio-player');
    if (player.paused) { player.play(); } else { player.pause(); }
}

function updatePlayBtn(playing) {
    // Play icons — hide when playing
    ['play-icon','mini-play-icon'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = playing ? 'none' : 'inline-block';
    });
    // Pause icons — show when playing
    ['pause-icon','mini-pause-icon'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = playing ? 'inline-block' : 'none';
    });
}

function seekTo(e) {
    const player = document.getElementById('audio-player');
    if (!player.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    player.currentTime = pct * player.duration;
}

function formatTime(sec) {
    if (isNaN(sec) || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

const _player = document.getElementById('audio-player');

_player.addEventListener('ended', () => {
    updatePlayBtn(false);
    if (repeatMode === 'one') {
        _player.currentTime = 0; _player.play();
    } else if (repeatMode === 'all') {
        playSong(getNextIdx());
    } else {
        if (currentIdx < playlist.length - 1) playSong(getNextIdx());
        else { updatePlayBtn(false); }
    }
});

_player.addEventListener('pause', () => {
    updatePlayBtn(false);
    stopBarAnimation();
});

_player.addEventListener('play', () => {
    updatePlayBtn(true);
    if (currentIdx >= 0) startBarAnimationCSS(currentIdx);
});

_player.addEventListener('timeupdate', () => {
    const pct = _player.duration ? (_player.currentTime / _player.duration) * 100 : 0;
    ['progress-bar', 'mini-progress-bar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.width = pct + '%';
    });
    const cur = document.getElementById('time-current');
    if (cur) cur.textContent = formatTime(_player.currentTime);
});

_player.addEventListener('loadedmetadata', () => {
    const tot = document.getElementById('time-total');
    if (tot) tot.textContent = formatTime(_player.duration);
});

// ============================================================
//  MINI PLAYER STICKY
// ============================================================
function showMiniPlayer() {
    const mini = document.getElementById('mini-player');
    if (mini) mini.classList.remove('hidden');
}

function hideMiniPlayer() {
    const mini = document.getElementById('mini-player');
    if (mini) mini.classList.add('hidden');
}

function miniSeekTo(e) {
    const player = document.getElementById('audio-player');
    if (!player.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    player.currentTime = pct * player.duration;
}

// ============================================================
//  WEB AUDIO VISUALIZER
// ============================================================
function initAudioContext() {
    if (audioCtx) return;
    const player = document.getElementById('audio-player');
    audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    analyser   = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.8;
    sourceNode = audioCtx.createMediaElementSource(player);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
}

function startVisualizer(idx) {
    stopVisualizer();
    try { initAudioContext(); } catch(e) { startBarAnimationCSS(idx); return; }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    drawPlayerVisualizer();
    startBarAnimationCSS(idx);
}

function drawPlayerVisualizer() {
    const canvas = document.getElementById('visualizer-canvas');
    if (!canvas || !analyser) return;
    const ctx     = canvas.getContext('2d');
    const W       = canvas.width;
    const H       = canvas.height;
    const bufLen  = analyser.frequencyBinCount;
    const dataArr = new Uint8Array(bufLen);

    function draw() {
        animFrameId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArr);
        ctx.clearRect(0, 0, W, H);
        const barCount = 28;
        const barW     = (W / barCount) - 2;
        const step     = Math.floor(bufLen / barCount);
        for (let i = 0; i < barCount; i++) {
            const val  = dataArr[i * step] / 255;
            const barH = Math.max(3, val * H);
            const x    = i * (barW + 2);
            const y    = H - barH;
            const alpha = 0.4 + val * 0.6;
            ctx.fillStyle = val > 0.7 ? `rgba(255,255,255,${alpha})` : `rgba(29,185,84,${alpha})`;
            ctx.beginPath();
            ctx.roundRect(x, y, barW, barH, 2);
            ctx.fill();
        }
    }
    draw();
}

function startBarAnimationCSS(idx) {
    stopBarAnimation();
    const barEl = document.getElementById(`bar-${idx}`);
    if (!barEl) return;
    barEl.classList.add('playing');
    barEl.innerHTML = `<span class="soundbar"><span class="bar b1"></span><span class="bar b2"></span><span class="bar b3"></span><span class="bar b4"></span></span>`;
}

function stopBarAnimation() {
    document.querySelectorAll('.soundbar').forEach(el => {
        const parent = el.closest('.track-icon');
        if (parent) { parent.innerHTML = '♪'; parent.classList.remove('playing'); }
    });
}

function stopVisualizer() {
    stopBarAnimation();
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    const canvas = document.getElementById('visualizer-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// ============================================================
//  MEDIA SESSION API
// ============================================================
function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play',          () => document.getElementById('audio-player').play());
    navigator.mediaSession.setActionHandler('pause',         () => document.getElementById('audio-player').pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => prevSong());
    navigator.mediaSession.setActionHandler('nexttrack',     () => nextSong());
    navigator.mediaSession.setActionHandler('seekbackward',  () => {
        const p = document.getElementById('audio-player');
        p.currentTime = Math.max(0, p.currentTime - 10);
    });
    navigator.mediaSession.setActionHandler('seekforward', () => {
        const p = document.getElementById('audio-player');
        p.currentTime = Math.min(p.duration || 0, p.currentTime + 10);
    });
}

function updateMediaSession(title, artist, album, coverUrl) {
    if (!('mediaSession' in navigator)) return;
    const artwork = coverUrl
        ? [{ src: coverUrl, sizes: '250x250', type: 'image/jpeg' }]
        : [{ src: 'https://bluegrayink.github.io/chlorowave/icon.png', sizes: '192x192', type: 'image/png' }];
    navigator.mediaSession.metadata = new MediaMetadata({
        title, artist,
        album:   album || 'ChloroWave',
        artwork
    });
    navigator.mediaSession.playbackState = 'playing';
}

function updateMediaSessionCover(coverUrl) {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.metadata) return;
    if (coverUrl) {
        navigator.mediaSession.metadata.artwork = [
            { src: coverUrl, sizes: '250x250', type: 'image/jpeg' }
        ];
    }
}

// ============================================================
//  HELPERS
// ============================================================
function sanitize(str) {
    return str.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}
