// ============================================================
//  CHLOROWAVE — app.js
// ============================================================

const CONFIG = {
    GOOGLE_CLIENT_ID: '721053641807-k0be448jbrkhd3cu9e5iuj6l7vv3nh0g.apps.googleusercontent.com',
    GAS_ENDPOINT: 'https://script.google.com/macros/s/AKfycbwccnydHu5Q6H1zvKN_awF_4Np4JtDSmc1GXSYSvBEYIqoXiBK9ZpklhcJAF0Qv-bGCNg/exec',
    FOLDER_NAME: 'chlorowave',
};

// ============================================================
//  STATE GLOBAL
// ============================================================
let accessToken  = null;
let userEmail    = null;
let playlist     = [];   // flat array semua lagu
let playlists    = {};   // { folderName: [songs] } + '' untuk root
let currentIdx   = -1;
let audioCtx     = null;
let analyser     = null;
let sourceNode   = null;
let animFrameId  = null;

// ============================================================
//  SCREEN NAVIGATION
// ============================================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// ============================================================
//  INIT
// ============================================================
window.addEventListener('load', () => {
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
document.getElementById('reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const errEl     = document.getElementById('reg-error');
    const btnText   = document.getElementById('reg-btn-text');
    const btnLoad   = document.getElementById('reg-btn-loader');
    const submitBtn = document.getElementById('reg-submit-btn');

    const prefix   = document.getElementById('f-email').value.trim().toLowerCase().replace(/@.*/, '');
    const email    = prefix + '@gmail.com';
    const shareUrl = document.getElementById('f-share').value.trim();
    const refNum   = document.getElementById('f-ref').value.trim();

    if (!prefix) { showError(errEl, 'Masukkan nama akun Gmail kamu'); return; }

    btnText.textContent = 'Mengirim...';
    btnLoad.classList.remove('hidden');
    submitBtn.disabled = true;
    errEl.classList.add('hidden');

    try {
        const url  = `${CONFIG.GAS_ENDPOINT}?action=register&email=${encodeURIComponent(email)}&shareUrl=${encodeURIComponent(shareUrl)}&refNum=${encodeURIComponent(refNum)}`;
        const res  = await fetch(url);
        const data = await res.json();
        if (!data.ok) throw new Error('Server menolak data');
        localStorage.setItem('cw_status', 'pending');
        localStorage.setItem('cw_email',  email);
        document.getElementById('pending-email-display').textContent = email;
        showScreen('screen-pending');
    } catch (err) {
        console.error('Register error:', err);
        showError(errEl, 'Gagal mengirim data. Coba lagi beberapa saat.');
    } finally {
        btnText.textContent = 'Kirim Pendaftaran';
        btnLoad.classList.add('hidden');
        submitBtn.disabled = false;
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
            if (response.error) { console.error('OAuth error:', response.error); return; }
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
        console.error('Login error:', err);
        alert('Terjadi kesalahan saat login. Coba lagi.');
    }
}

async function checkWhitelist(email) {
    try {
        const res  = await fetch(`${CONFIG.GAS_ENDPOINT}?action=checkWhitelist&email=${encodeURIComponent(email)}`);
        const data = await res.json();
        return data.active === true;
    } catch (err) { return false; }
}

function onLoginSuccess(user) {
    if (!localStorage.getItem('cw_username')) {
        localStorage.setItem('cw_username', user.given_name || user.email.split('@')[0]);
    }
    localStorage.setItem('cw_status', 'active');
    localStorage.setItem('cw_email',  userEmail);
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
    if (menu && !profile.contains(e.target)) menu.classList.add('hidden');
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
        stopVisualizer();
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
//  GOOGLE DRIVE — Cari folder 'chlorowave' lalu ambil isinya
// ============================================================
async function fetchSongsFromDrive() {
    const listEl = document.getElementById('playlist-ui');
    listEl.innerHTML = '<li class="playlist-loading">Mencari folder chlorowave...</li>';
    document.getElementById('song-count').textContent = '';

    try {
        // 1. Cari folder bernama 'chlorowave' di root Drive
        const folderQuery = encodeURIComponent(`name='${CONFIG.FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
        const folderRes   = await fetch(`https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=files(id,name)`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const folderData  = await folderRes.json();

        if (!folderData.files || folderData.files.length === 0) {
            listEl.innerHTML = `
                <li class="playlist-error" style="line-height:1.8">
                    ⚠️ Folder <strong>'chlorowave'</strong> tidak ditemukan di Google Drive kamu.<br><br>
                    Cara membuat:<br>
                    1. Buka <a href="https://drive.google.com" target="_blank" style="color:var(--green)">Google Drive</a><br>
                    2. Klik <strong>+ New → Folder</strong><br>
                    3. Beri nama persis: <strong>chlorowave</strong> (huruf kecil semua)<br>
                    4. Upload lagu ke folder tersebut<br>
                    5. Refresh halaman ini
                </li>`;
            return;
        }

        const rootFolderId = folderData.files[0].id;

        // 2. Ambil semua isi folder chlorowave (lagu + subfolder)
        await loadFolderContents(rootFolderId);

        // 3. Hitung total lagu
        const totalSongs = playlist.length;
        document.getElementById('song-count').textContent = `${totalSongs} lagu`;

        if (totalSongs === 0) {
            listEl.innerHTML = '<li class="playlist-empty">Folder chlorowave kosong. Upload lagu dulu!</li>';
            return;
        }

        renderPlaylist();
        setupMediaSession();

    } catch (err) {
        console.error('Drive fetch error:', err);
        listEl.innerHTML = `<li class="playlist-error">Gagal memuat: ${err.message}</li>`;
    }
}

async function loadFolderContents(folderId) {
    playlist  = [];
    playlists = {};

    // Ambil semua file & subfolder dalam folder chlorowave
    const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res   = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType)&pageSize=200&orderBy=name`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data  = await res.json();

    if (!data.files) return;

    const rootSongs    = [];
    const subfolders   = [];

    for (const file of data.files) {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
            subfolders.push(file);
        } else if (isAudioFile(file)) {
            rootSongs.push(file);
        }
    }

    // Lagu di root chlorowave — langsung masuk playlist tanpa nama folder
    for (const song of rootSongs) {
        playlist.push({ ...song, playlistName: null });
    }

    // Subfolder = playlist
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
}

function isAudioFile(file) {
    // Cek via mimeType audio/* atau ekstensi file umum
    if (file.mimeType && file.mimeType.startsWith('audio/')) return true;
    const audioExts = /\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|aiff|ape|mp4)$/i;
    return audioExts.test(file.name);
}

// ============================================================
//  RENDER PLAYLIST
// ============================================================
function renderPlaylist() {
    const listEl = document.getElementById('playlist-ui');
    let html     = '';
    let idx      = 0;

    // 1. Lagu root (tanpa nama playlist)
    const rootSongs = playlist.filter(s => s.playlistName === null);
    for (const song of rootSongs) {
        const i = playlist.indexOf(song);
        html += trackHTML(i, song);
        idx++;
    }

    // 2. Subfolder playlist
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
    const name = song.name.replace(/\.[^.]+$/, '');
    return `
        <li id="track-${idx}" onclick="playSong(${idx})">
            <span class="track-icon" id="bar-${idx}">♪</span>
            <span class="track-name">${sanitize(name)}</span>
        </li>`;
}

function sanitize(str) {
    return str.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
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

    // Update UI aktif
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

    songEl.textContent = '⏳ Memuat...';

    try {
        const res  = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        const prev = player.src;
        player.src = URL.createObjectURL(blob);

        await player.play();

        const name = file.name.replace(/\.[^.]+$/, '');
        songEl.textContent = name;

        // Animasi sound bar di track aktif
        startBarAnimation(idx);

        // Media Session
        updateMediaSession(name, file.playlistName);

        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);

    } catch (err) {
        console.error('Playback error:', err);
        songEl.textContent = '⚠ Gagal memutar: ' + file.name;
    }
}

function prevSong() { if (playlist.length) playSong(currentIdx <= 0 ? playlist.length - 1 : currentIdx - 1); }
function nextSong() { if (playlist.length) playSong(currentIdx >= playlist.length - 1 ? 0 : currentIdx + 1); }

document.getElementById('audio-player').addEventListener('ended', () => nextSong());
document.getElementById('audio-player').addEventListener('pause',  () => stopBarAnimation());
document.getElementById('audio-player').addEventListener('play',   () => { if (currentIdx >= 0) startBarAnimation(currentIdx); });

// ============================================================
//  SOUND BAR ANIMATION
// ============================================================
function startBarAnimation(idx) {
    stopBarAnimation();
    const barEl = document.getElementById(`bar-${idx}`);
    if (!barEl) return;

    barEl.classList.add('playing');
    barEl.innerHTML = `
        <span class="soundbar">
            <span class="bar b1"></span>
            <span class="bar b2"></span>
            <span class="bar b3"></span>
            <span class="bar b4"></span>
        </span>`;
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
}

// ============================================================
//  MEDIA SESSION API — Background + Notif Control
// ============================================================
function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play',          () => { document.getElementById('audio-player').play(); });
    navigator.mediaSession.setActionHandler('pause',         () => { document.getElementById('audio-player').pause(); });
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

function updateMediaSession(title, album) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
        title:  title,
        artist: 'ChloroWave',
        album:  album || 'chlorowave',
        artwork: [{ src: 'https://bluegrayink.github.io/chlorowave/icon.png', sizes: '192x192', type: 'image/png' }]
    });
}
