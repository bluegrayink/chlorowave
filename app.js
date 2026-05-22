// ============================================================
//  CHLOROWAVE — app.js (FIXED LOGIC & COUPLING)
//  Features: Cover Art (MusicBrainz), Shuffle, Repeat, Mini Player
// ============================================================

const CONFIG = {
    GOOGLE_CLIENT_ID:    '721053641807-k0be448jbrkhd3cu9e5iuj6l7vv3nh0g.apps.googleusercontent.com',
    GAS_ENDPOINT:        'https://script.google.com/macros/s/AKfycbwccnydHu5Q6H1zvKN_awF_4Np4JtDSmc1GXSYSvBEYIqoXiBK9ZpkIhcJAF0Qv-bGCNg/exec',
    FOLDER_NAME:         'chlorowave',
    TEMANQRIS_MERCHANT:  'MQ4F26C50380',
    TEMANQRIS_AMOUNT:    100000,
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
let coverCache   = {}; 
let shuffleQueue    = []; 
let shufflePlayed   = []; 
let regData = { email: '', shareUrl: '' };

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
//  INIT LIFECYCLE
// ============================================================
window.addEventListener('load', async () => {
    const params = new URLSearchParams(window.location.search);
    
    const refCode = params.get('ref');
    if (refCode) {
        localStorage.setItem('cw_ref', refCode.toUpperCase());
    }

    if (params.get('payment') === 'success') {
        const email    = params.get('email');
        const shareUrl = params.get('share') || localStorage.getItem('cw_reg_shareUrl') || '';
        if (email) {
            try {
                const refBy = localStorage.getItem('cw_ref') || '';
                await fetch(`${CONFIG.GAS_ENDPOINT}?action=register&email=${encodeURIComponent(email)}&shareUrl=${encodeURIComponent(shareUrl)}&refNum=QRIS-TEMANQRIS&refBy=${encodeURIComponent(refBy)}`);
            } catch(err) { console.error('GAS register error:', err); }
            localStorage.setItem('cw_status', 'pending');
            localStorage.setItem('cw_email',  email);
            window.history.replaceState({}, '', window.location.pathname);
            
            const pendingDisplay = document.getElementById('pending-email-display');
            if(pendingDisplay) pendingDisplay.textContent = email;
            showScreen('screen-pending');
            return;
        }
    }

    if (params.has('ref') || params.has('payment')) {
        window.history.replaceState({}, '', window.location.pathname);
    }

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
        const pendingDisplay = document.getElementById('pending-email-display');
        if(pendingDisplay) pendingDisplay.textContent = email;
        showScreen('screen-pending');
    } else {
        showScreen('screen-landing');
    }
});

// ============================================================
//  FIXED LOGIC: MENYESUAIKAN DENGAN FORMAT FORMAT LAYOUT LAMA
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
    // FIX: Menggunakan querySelector karena di HTML bawaan menggunakan class (.reg-form) bukan ID
    const regForm = document.querySelector('.reg-form') || document.getElementById('reg-form');
    if (!regForm) return;

    regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Membaca elemen error & submit-btn berdasarkan layout aslimu
        const errEl     = document.getElementById('reg-error') || regForm.querySelector('.error-msg');
        const submitBtn = document.getElementById('reg-submit-btn') || regForm.querySelector('button[type="submit"]');

        // Mengambil input values berdasarkan tipe / urutan layout aslimu
        const emailInput = document.getElementById('f-email') || regForm.querySelector('input[type="text"]');
        const shareInput = document.getElementById('f-share') || regForm.querySelector('input[type="url"]') || regForm.querySelectorAll('input')[1];

        if (!emailInput || !shareInput) return;

        const prefix   = emailInput.value.trim().toLowerCase().replace(/@.*/, '');
        const email    = prefix + '@gmail.com';
        const shareUrl = shareInput.value.trim();

        if (!prefix) { if(errEl) showError(errEl, 'Masukkan nama akun Gmail kamu'); return; }
        if (!shareUrl) { if(errEl) showError(errEl, 'Masukkan link share sosmed kamu'); return; }

        if(errEl) errEl.classList.add('hidden');
        const refBy = localStorage.getItem('cw_ref') || '';

        regData = { email, shareUrl };
        localStorage.setItem('cw_reg_email',    email);
        localStorage.setItem('cw_reg_shareUrl', shareUrl);

        try {
            if(submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
            }
            
            // Kirim entri data registrasi ke Google Apps Script
            await fetch(`${CONFIG.GAS_ENDPOINT}?action=register&email=${encodeURIComponent(email)}&shareUrl=${encodeURIComponent(shareUrl)}&refNum=PENDING-QRIS&refBy=${encodeURIComponent(refBy)}`);
            
            // Inisialisasi Tombol QRIS Widget langsung disisipkan di dalam form agar layout aman
            initTemanqrisWidget(email, shareUrl, regForm);

            if(submitBtn) submitBtn.style.display = 'none';
            emailInput.disabled = true;
            shareInput.disabled = true;

        } catch(err) {
            if(errEl) showError(errEl, 'Gagal menghubungi server database. Coba sesaat lagi.');
            if(submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> Lanjutkan Pembayaran';
            }
        }
    });
});

// FIX LOGIC: Membuat container widget dinamis agar tidak merusak susunan struktur HTML asli
function initTemanqrisWidget(email, shareUrl, formElement) {
    let container = document.getElementById('qr-widget-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'qr-widget-container';
        container.style.marginTop = '20px';
        container.style.textAlign = 'center';
        formElement.appendChild(container); // Masukkan otomatis di paling bawah form
    }
    container.innerHTML = '';

    const callbackUrl = window.location.origin + window.location.pathname +
        '?payment=success&email=' + encodeURIComponent(email) +
        '&share=' + encodeURIComponent(shareUrl);

    const div = document.createElement('div');
    div.setAttribute('data-temanqris',       '');
    div.setAttribute('data-merchant',        CONFIG.TEMANQRIS_MERCHANT);
    div.setAttribute('data-amount',          CONFIG.TEMANQRIS_AMOUNT);
    div.setAttribute('data-button-text',     'Bayar Rp 100.000 dengan QRIS');
    div.setAttribute('data-button-color',    '#1DB954');
    div.setAttribute('data-description',     'ChloroWave-' + email);
    div.setAttribute('data-callback',        callbackUrl);
    div.setAttribute('data-webhook',         CONFIG.GAS_ENDPOINT + '?action=paymentWebhook');
    container.appendChild(div);

    const script = document.createElement('script');
    script.src = 'https://temanqris.com/widget.js?t=' + Date.now();
    document.body.appendChild(script);
}

function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }

// ============================================================
//  OAUTH2 LOGIN GOOGLE & WHITELIST VERIFICATION
// ============================================================
function tryLogin() {
    if (typeof google === 'undefined') {
        alert('Layanan Google GSI gagal dimuat. Periksa koneksi internet.');
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
            const deniedEmailEl = document.getElementById('denied-email');
            if(deniedEmailEl) deniedEmailEl.textContent = userEmail;
            openModal('modal-denied');
            accessToken = null; userEmail = null;
        }
    } catch (err) {
        alert('Terjadi error otentikasi profile. Silakan coba login kembali.');
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
    saveSession(accessToken, userEmail);
    updateUsernameUI();
    showScreen('screen-app');
    fetchSongsFromDrive();
    fetchAndShowRefCode(userEmail);
}

async function fetchAndShowRefCode(email) {
    try {
        const res  = await fetch(`${CONFIG.GAS_ENDPOINT}?action=getReferralCode&email=${encodeURIComponent(email)}`);
        const data = await res.json();
        if (data.ok && data.refCode) {
            localStorage.setItem('cw_my_ref', data.refCode);
            updateRefUI(data.refCode);
        }
    } catch (err) { console.error('Gagal mengambil kode referral:', err); }
}

function updateRefUI(refCode) {
    if (!refCode) return;
    const display = document.getElementById('ref-code-display');
    if (display) display.textContent = refCode;
}

// ============================================================
//  USER PROFILE & REFERRAL LINK COUPLING
// ============================================================
function updateUsernameUI() {
    const name = localStorage.getItem('cw_username') || userEmail?.split('@')[0] || 'User';
    const display = document.getElementById('username-display');
    if (display) display.textContent = '👤 ' + name;
    showRefCode();
}

function getMyRefCode() {
    let code = localStorage.getItem('cw_my_ref');
    if (!code && userEmail) {
        const prefix = userEmail.split('@')[0].replace(/[^a-z0-9]/gi, '').substring(0, 6).toUpperCase();
        const num = Math.floor(1000 + Math.random() * 9000);
        code = prefix + num;
        localStorage.setItem('cw_my_ref', code);
    }
    return code || 'USER1234';
}

function getMyRefLink() {
    return `${window.location.origin}${window.location.pathname}?ref=${getMyRefCode()}`;
}

function copyRefLink() {
    const link = getMyRefLink();
    navigator.clipboard.writeText(link).then(() => {
        const btn = document.getElementById('copy-ref-btn');
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Tersalin!';
            setTimeout(() => {
                btn.innerHTML = '<i class="fa-solid fa-copy"></i> Salin Link';
            }, 2000);
        }
    });
}

function showRefCode() {
    const code = getMyRefCode();
    const link = getMyRefLink();
    const el   = document.getElementById('ref-code-display');
    if (el) {
        el.textContent = code;
        el.style.display = 'block';
    }
    const linkEl = document.getElementById('ref-link-display');
    if (linkEl) linkEl.value = link;
}

function toggleUserMenu() { 
    const menu = document.getElementById('user-menu');
    if(menu) menu.classList.toggle('hidden'); 
}

document.addEventListener('click', (e) => {
    const menu    = document.getElementById('user-menu');
    const profile = document.getElementById('user-profile');
    if (menu && !profile?.contains(e.target)) menu.classList.add('hidden');
});

function saveUsername() {
    const input = document.getElementById('edit-username-input');
    if(!input) return;
    const val = input.value.trim();
    if (val) {
        localStorage.setItem('cw_username', val);
        updateUsernameUI();
        input.value = '';
        const menu = document.getElementById('user-menu');
        if(menu) menu.classList.add('hidden');
    }
}

function logout() {
    if (confirm('Yakin mau logout dari ChloroWave?')) {
        accessToken = null; userEmail = null; playlist = []; playlists = {}; currentIdx = -1;
        clearSession();
        stopVisualizer();
        hideMiniPlayer();
        showScreen('screen-landing');
    }
}

function resetPending() {
    if (confirm('Data pendaftaran sebelumnya akan dihapus dari browser. Lanjut?')) {
        localStorage.removeItem('cw_status');
        localStorage.removeItem('cw_email');
        showScreen('screen-register');
    }
}

function openModal(id)  { const el = document.getElementById(id); if(el) el.classList.remove('hidden'); }
function closeModal(id) { const el = document.getElementById(id); if(el) el.classList.add('hidden'); }

// ============================================================
//  GOOGLE DRIVE MEDIA LOADER
// ============================================================
async function fetchSongsFromDrive() {
    const listEl = document.getElementById('playlist-ui');
    if(!listEl) return;
    listEl.innerHTML = '<li class="playlist-loading"><i class="fa-solid fa-spinner fa-spin"></i> Mencari folder chlorowave...</li>';
    
    const countEl = document.getElementById('song-count');
    if(countEl) countEl.textContent = '';

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
                    <div class="fnf-title">Folder 'chlorowave' Tidak Ditemukan</div>
                    <div class="fnf-desc">Silakan buat folder baru bernama <code>chlorowave</code> di Google Drive Anda.</div>
                </li>`;
            return;
        }

        const rootFolderId = folderData.files[0].id;
        await loadFolderContents(rootFolderId);

        const totalSongs = playlist.length;
        if(countEl) countEl.textContent = `${totalSongs} lagu`;

        if (totalSongs === 0) {
            listEl.innerHTML = '<li class="playlist-empty">Folder ditemukan, namun belum ada musik di dalamnya.</li>';
            return;
        }

        renderPlaylist();
        setupMediaSession();

    } catch (err) {
        listEl.innerHTML = `<li class="playlist-error">Gagal sinkronisasi: ${err.message}</li>`;
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

    rebuildShuffleIdxs();
}

function isAudioFile(file) {
    if (file.mimeType && file.mimeType.startsWith('audio/')) return true;
    return /\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|aiff|ape|mp4)$/i.test(file.name);
}

// ============================================================
//  RENDER PLAYLIST GENERATOR
// ============================================================
function renderPlaylist() {
    const listEl = document.getElementById('playlist-ui');
    if(!listEl) return;
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

    listEl.innerHTML = html || '<li class="playlist-empty">Tidak ada trek musik tersedia.</li>';
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
            <span class="track-icon" id="bar-${idx}">▶</span>
        </li>`;
}

function parseSongName(filename) {
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
    const query  = parsed.artist ? `recording:"${parsed.title}" AND artist:"${parsed.artist}"` : `recording:"${parsed.title}"`;
    try {
        const mbRes  = await fetch(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&limit=1&fmt=json`, { headers: { 'User-Agent': 'ChloroWave/1.0 (cs.chlorowave@gmail.com)' } });
        const mbData = await mbRes.json();
        if (!mbData.recordings || mbData.recordings.length === 0) return null;
        const releaseId = mbData.recordings[0].releases?.[0]?.id;
        if (!releaseId) return null;
        const caRes = await fetch(`https://coverartarchive.org/release/${releaseId}/front-250`);
        if (!caRes.ok) return null;
        coverCache[songName] = caRes.url;
        return caRes.url;
    } catch { return null; }
}

async function updateCoverArt(songName, idx) {
    const playerCover = document.getElementById('player-cover');
    const playerInit  = document.getElementById('player-cover-initial');
    const parsed      = parseSongName(songName);
    const colors      = gradientColors(songName);

    if(playerCover) playerCover.style.background = `linear-gradient(135deg,${colors[0]},${colors[1]})`;
    if (playerInit) playerInit.textContent = parsed.artist ? parsed.artist[0].toUpperCase() : songName[0].toUpperCase();

    const coverUrl = await fetchCoverArt(songName);
    if (coverUrl) {
        if(playerCover) {
            playerCover.style.backgroundImage = `url('${coverUrl}')`;
            playerCover.style.backgroundSize  = 'cover';
            playerCover.style.backgroundPosition = 'center';
        }

        const thumb = document.getElementById(`thumb-${idx}`);
        if (thumb) {
            thumb.style.backgroundImage    = `url('${coverUrl}')`;
            thumb.style.backgroundSize     = 'cover';
            thumb.style.backgroundPosition = 'center';
            const initial = thumb.querySelector('.track-thumb-initial');
            if (initial) initial.style.display = 'none';
        }

        const miniCover = document.getElementById('mini-cover');
        if (miniCover) {
            miniCover.style.backgroundImage    = `url('${coverUrl}')`;
            miniCover.style.backgroundSize     = 'cover';
            miniCover.style.backgroundPosition = 'center';
            miniCover.textContent = '';
        }
        updateMediaSessionCover(coverUrl);
    }
}

// ============================================================
//  PLAYER OPERATION LOGIC
// ============================================================
function rebuildShuffleIdxs() {
    shuffleQueue  = [...Array(playlist.length).keys()];
    shufflePlayed = [];
    if (currentIdx >= 0) {
        shuffleQueue  = shuffleQueue.filter(i => i !== currentIdx);
        shufflePlayed = [currentIdx];
    }
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

function refreshPlaylist() { fetchSongsFromDrive(); }

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
        if (!shufflePlayed.includes(currentIdx)) shufflePlayed.push(currentIdx);
        shuffleQueue = shuffleQueue.filter(i => i !== currentIdx);
        if (shuffleQueue.length === 0) rebuildShuffleIdxs();
        return shuffleQueue[0];
    }
    return currentIdx >= playlist.length - 1 ? 0 : currentIdx + 1;
}

function getPrevIdx() {
    if (shuffleMode) {
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

async function playSong(idx) {
    if (idx < 0 || idx >= playlist.length) return;

    currentIdx = idx;
    const file   = playlist[idx];
    const player = document.getElementById('audio-player');
    if(!player) return;
    const parsed = parseSongName(file.name.replace(/\.[^.]+$/, ''));

    document.querySelectorAll('#playlist-ui li.track-active').forEach(li => {
        li.classList.remove('track-active');
        const bar = li.querySelector('.track-icon');
        if (bar) { bar.innerHTML = '▶'; bar.classList.remove('playing'); }
    });

    const trackEl = document.getElementById(`track-${idx}`);
    if (trackEl) {
        trackEl.classList.add('track-active');
        trackEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const displayName = parsed.title || file.name.replace(/\.[^.]+$/, '');
    const pTitle = document.getElementById('player-title');
    const pArtist = document.getElementById('player-artist');
    if(pTitle) pTitle.textContent  = displayName;
    if(pArtist) pArtist.textContent = parsed.artist || 'ChloroWave';

    const miniTitle  = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    if (miniTitle)  miniTitle.textContent  = displayName;
    if (miniArtist) miniArtist.textContent = parsed.artist || 'ChloroWave';

    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        const prev = player.src;
        player.src = URL.createObjectURL(blob);
        await player.play();

        showMiniPlayer();
        startVisualizer(idx);
        updateMediaSession(displayName, parsed.artist || 'ChloroWave', file.playlistName);
        updateCoverArt(file.name.replace(/\.[^.]+$/, ''), idx);

        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
    } catch (err) {
        if(pTitle) pTitle.textContent = '❌ Gagal Memuat Musik';
    }
}

function prevSong() { if (playlist.length) playSong(getPrevIdx()); }
function nextSong() { if (playlist.length) playSong(getNextIdx()); }

function togglePlay() {
    const player = document.getElementById('audio-player');
    if(!player) return;
    if (player.paused) { player.play(); } else { player.pause(); }
}

function updatePlayBtn(playing) {
    ['play-icon','mini-play-icon'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = playing ? 'none' : 'inline-block';
    });
    ['pause-icon','mini-pause-icon'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = playing ? 'inline-block' : 'none';
    });
}

function seekTo(e) {
    const player = document.getElementById('audio-player');
    if (!player || !player.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    player.currentTime = pct * player.duration;
}

function miniSeekTo(e) {
    const player = document.getElementById('audio-player');
    if (!player || !player.duration) return;
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

// Inisialisasi Player Event Listeners
window.addEventListener('DOMContentLoaded', () => {
    const _player = document.getElementById('audio-player');
    if (!_player) return;

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

    _player.addEventListener('pause', () => { updatePlayBtn(false); stopBarAnimation(); });
    _player.addEventListener('play', () => { updatePlayBtn(true); if (currentIdx >= 0) startBarAnimationCSS(currentIdx); });

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
});

function showMiniPlayer() { const mini = document.getElementById('mini-player'); if (mini) mini.classList.remove('hidden'); }
function hideMiniPlayer() { const mini = document.getElementById('mini-player'); if (mini) mini.classList.add('hidden'); }

// ============================================================
//  WEB AUDIO CANVAS VISUALIZER
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
        if (parent) { parent.innerHTML = '▶'; parent.classList.remove('playing'); }
    });
}

function stopVisualizer() {
    stopBarAnimation();
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    const canvas = document.getElementById('visualizer-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// ============================================================
//  OS BROWSER SYSTEMS BACKGROUND (MEDIA SESSION API)
// ============================================================
function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play',          () => document.getElementById('audio-player').play());
    navigator.mediaSession.setActionHandler('pause',         () => document.getElementById('audio-player').pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => prevSong());
    navigator.mediaSession.setActionHandler('nexttrack',     () => nextSong());
}

function updateMediaSession(title, artist, album, coverUrl) {
    if (!('mediaSession' in navigator)) return;
    const artwork = coverUrl ? [{ src: coverUrl, sizes: '250x250', type: 'image/jpeg' }] : [{ src: 'https://bluegrayink.github.io/chlorowave/icon.png', sizes: '192x192', type: 'image/png' }];
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: album || 'ChloroWave', artwork });
}

function updateMediaSessionCover(coverUrl) {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.metadata) return;
    if (coverUrl) navigator.mediaSession.metadata.artwork = [{ src: coverUrl, sizes: '250x250', type: 'image/jpeg' }];
}

function sanitize(str) {
    return str.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}
