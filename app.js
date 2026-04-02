// ============================================================
//  CHLOROWAVE — app.js
// ============================================================

const CONFIG = {
    GOOGLE_CLIENT_ID: '56742945749-gm2otrtbtqilaquo4rt54hk59v80ld1h.apps.googleusercontent.com',
    GAS_ENDPOINT: 'https://script.google.com/macros/s/AKfycbyqOhNbZouhCXv5fdHRLBb1OIe9kIK9waVgwty0j_rHXYRHwRtrimvuvOqxLQRoh79q/exec',
};

let accessToken = null;
let userEmail   = null;
let playlist    = [];
let currentIdx  = -1;

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

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
//  REGISTRASI — Kirim ke GAS, GAS simpan ke Sheet
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

    if (!prefix) {
        showError(errEl, 'Masukkan nama akun Gmail kamu');
        return;
    }

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

function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
}

// ============================================================
//  LOGIN
// ============================================================
function tryLogin() {
    if (typeof google === 'undefined') {
        alert('Koneksi internet diperlukan untuk login. Coba muat ulang halaman.');
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
            accessToken = null;
            userEmail   = null;
        }
    } catch (err) {
        console.error('Login error:', err);
        alert('Terjadi kesalahan saat login. Coba lagi.');
    }
}

async function checkWhitelist(email) {
    try {
        const url  = `${CONFIG.GAS_ENDPOINT}?action=checkWhitelist&email=${encodeURIComponent(email)}`;
        const res  = await fetch(url);
        const data = await res.json();
        return data.active === true;
    } catch (err) {
        console.error('Whitelist check error:', err);
        return false;
    }
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

function toggleUserMenu() {
    document.getElementById('user-menu').classList.toggle('hidden');
}

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
        accessToken = null; userEmail = null; playlist = []; currentIdx = -1;
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
    listEl.innerHTML = '<li class="playlist-loading">Memuat lagu...</li>';
    try {
        const mimeTypes = ['audio/mpeg','audio/flac','audio/mp4','audio/ogg','audio/wav','audio/x-wav']
            .map(m => `mimeType="${m}"`).join(' or ');
        const url  = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(mimeTypes)}&fields=files(id,name,mimeType,size)&pageSize=200&orderBy=name`;
        const res  = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        if (!data.files || data.files.length === 0) {
            listEl.innerHTML = '<li class="playlist-empty">Drive kosong. Upload MP3 ke Google Drive kamu dulu.</li>';
            return;
        }
        playlist = data.files;
        document.getElementById('song-count').textContent = `${playlist.length} lagu`;
        renderPlaylist();
    } catch (err) {
        console.error('Drive fetch error:', err);
        listEl.innerHTML = `<li class="playlist-error">Gagal memuat: ${err.message}</li>`;
    }
}

function renderPlaylist() {
    document.getElementById('playlist-ui').innerHTML = playlist.map((file, idx) => `
        <li id="track-${idx}" onclick="playSong(${idx})">
            <span class="track-icon">♪</span>
            <span class="track-name">${sanitize(file.name.replace(/\.[^.]+$/, ''))}</span>
        </li>
    `).join('');
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

    document.querySelectorAll('#playlist-ui li').forEach(li => li.classList.remove('active'));
    const trackEl = document.getElementById(`track-${idx}`);
    if (trackEl) { trackEl.classList.add('active'); trackEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }

    songEl.textContent = '⏳ Memuat: ' + file.name.replace(/\.[^.]+$/, '');
    try {
        const res  = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const prev = player.src;
        player.src = URL.createObjectURL(blob);
        player.play();
        songEl.textContent = '▶ ' + file.name.replace(/\.[^.]+$/, '');
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
    } catch (err) {
        console.error('Playback error:', err);
        songEl.textContent = '⚠ Gagal memutar: ' + file.name;
    }
}

function prevSong() { if (playlist.length) playSong(currentIdx <= 0 ? playlist.length - 1 : currentIdx - 1); }
function nextSong() { if (playlist.length) playSong(currentIdx >= playlist.length - 1 ? 0 : currentIdx + 1); }

document.getElementById('audio-player').addEventListener('ended', () => nextSong());

// ============================================================
//  REQUEST LAGU
// ============================================================
function sendRequest() {
    const input = document.getElementById('song-request');
    const song  = input.value.trim();
    if (!song) return;
    fetch(`${CONFIG.GAS_ENDPOINT}?action=songRequest&song=${encodeURIComponent(song)}&email=${encodeURIComponent(userEmail || '')}`)
        .catch(() => {});
    alert(`Request "${song}" terkirim! ✅`);
    input.value = '';
}
