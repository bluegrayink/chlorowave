// ============================================================
//  CHLOROWAVE — app.js
//  KONFIGURASI: Isi 3 konstanta di bawah sebelum deploy
// ============================================================

const CONFIG = {
    // 1. Client ID Google Cloud kamu (OAuth 2.0)
    GOOGLE_CLIENT_ID: '56742945749-gm2otrtbtqilaquo4rt54hk59v80ld1h.apps.googleusercontent.com',

    // 2. URL Google Apps Script Web App (deploy sebagai web app, akses "Anyone")
    //    Lihat file gas-script.js untuk cara deploy
    GAS_ENDPOINT: 'https://script.google.com/macros/s/AKfycbyqOhNbZouhCXv5fdHRLBb1OIe9kIK9waVgwty0j_rHXYRHwRtrimvuvOqxLQRoh79q/exec',

    // 3. URL Google Form untuk pendaftaran
    //    Format: https://docs.google.com/forms/d/e/FORM_ID/formResponse
    //    Ganti FORM_ID dengan ID form kamu, dan sesuaikan entry.XXXXXXX di bawah
    FORM_ENDPOINT: 'https://docs.google.com/forms/d/e/1FAIpQLSe0D8TWt1iYYUnsOUUUxgV7KGCrnFfOLYo9eyyy37rvik959g/formResponse',
    
    // 4. Mapping field Google Form (klik kanan field di form preview > Inspect > cari "entry.XXXX")
    FORM_FIELDS: {
        email:    'entry.53353815',   // Ganti dengan entry ID field Email di form kamu
        shareUrl: 'entry.244482656',   // Ganti dengan entry ID field Link Share
        refNum:   'entry.1852014800',   // Ganti dengan entry ID field Nomor Referensi
    }
};

// ============================================================
//  STATE GLOBAL
// ============================================================
let accessToken = null;
let userEmail   = null;
let playlist    = [];
let currentIdx  = -1;

// ============================================================
//  SCREEN NAVIGATION
// ============================================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// ============================================================
//  INIT: Cek status saat halaman dibuka
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
//  REGISTRASI — Submit Form ke Google Form
// ============================================================
document.getElementById('reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const errEl    = document.getElementById('reg-error');
    const btnText  = document.getElementById('reg-btn-text');
    const btnLoad  = document.getElementById('reg-btn-loader');
    const submitBtn = document.getElementById('reg-submit-btn');

    const prefix   = document.getElementById('f-email').value.trim().toLowerCase().replace(/@.*/, '');
    const email    = prefix + '@gmail.com';
    const shareUrl = document.getElementById('f-share').value.trim();
    const refNum   = document.getElementById('f-ref').value.trim();

    if (!prefix) {
        showError(errEl, 'Masukkan nama akun Gmail kamu');
        return;
    }

    // Loading state
    btnText.textContent = 'Mengirim...';
    btnLoad.classList.remove('hidden');
    submitBtn.disabled = true;
    errEl.classList.add('hidden');

    try {
        const iframe = document.createElement('iframe');
iframe.name = 'hidden-form-target';
iframe.style.display = 'none';
document.body.appendChild(iframe);

const form = document.createElement('form');
form.action = CONFIG.FORM_ENDPOINT;
form.method = 'POST';
form.target = 'hidden-form-target';

const fields = {
    [CONFIG.FORM_FIELDS.email]:    email,
    [CONFIG.FORM_FIELDS.shareUrl]: shareUrl,
    [CONFIG.FORM_FIELDS.refNum]:   refNum,
};

for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
}

document.body.appendChild(form);
form.submit();

await new Promise(resolve => setTimeout(resolve, 1500));

        // Simpan status pending di lokal
        localStorage.setItem('cw_status', 'pending');
        localStorage.setItem('cw_email',  email);

        // Tampilkan screen pending
        document.getElementById('pending-email-display').textContent = email;
        showScreen('screen-pending');

    } catch (err) {
        // no-cors selalu resolve, tapi jaga-jaga kalau ada error jaringan
        // Tetap anggap berhasil dan simpan pending (data kemungkinan sudah masuk)
        console.error('Form submit error:', err);
        localStorage.setItem('cw_status', 'pending');
        localStorage.setItem('cw_email',  email);
        document.getElementById('pending-email-display').textContent = email;
        showScreen('screen-pending');
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
//  LOGIN — Google OAuth + Whitelist Check
// ============================================================
function tryLogin() {
    // Cek Google Identity Services sudah load
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
            if (response.error) {
                console.error('OAuth error:', response.error);
                return;
            }
            accessToken = response.access_token;
            await handlePostLogin();
        },
    });

    client.requestAccessToken();
}

async function handlePostLogin() {
    try {
        // 1. Ambil info user dari Google
        const res  = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const user = await res.json();
        userEmail  = user.email;

        // 2. Cek whitelist via Google Apps Script
        const isWhitelisted = await checkWhitelist(userEmail);

        if (isWhitelisted) {
            // Akun aktif — masuk ke app
            onLoginSuccess(user);
        } else {
            // Tidak di whitelist — tampilkan modal denied
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
        const url = `${CONFIG.GAS_ENDPOINT}?action=checkWhitelist&email=${encodeURIComponent(email)}`;
        const res  = await fetch(url);
        const data = await res.json();
        return data.active === true;
    } catch (err) {
        console.error('Whitelist check error:', err);
        // Jika GAS endpoint gagal (belum dikonfigurasi), tolak akses
        return false;
    }
}

function onLoginSuccess(user) {
    // Set username dari lokal atau gunakan nama Google
    if (!localStorage.getItem('cw_username')) {
        const name = user.given_name || user.email.split('@')[0];
        localStorage.setItem('cw_username', name);
    }

    // Update status jadi active
    localStorage.setItem('cw_status', 'active');
    localStorage.setItem('cw_email',  userEmail);

    // Tampilkan app
    updateUsernameUI();
    showScreen('screen-app');
    fetchSongsFromDrive();
}

// ============================================================
//  USER PROFILE & MENU
// ============================================================
function updateUsernameUI() {
    const name = localStorage.getItem('cw_username') || userEmail?.split('@')[0] || 'User';
    document.getElementById('username-display').textContent = '👤 ' + name;
}

function toggleUserMenu() {
    document.getElementById('user-menu').classList.toggle('hidden');
}

// Tutup user menu saat klik di luar
document.addEventListener('click', (e) => {
    const menu    = document.getElementById('user-menu');
    const profile = document.getElementById('user-profile');
    if (menu && !profile.contains(e.target)) {
        menu.classList.add('hidden');
    }
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
        accessToken = null;
        userEmail   = null;
        playlist    = [];
        currentIdx  = -1;
        // Hapus sesi tapi pertahankan status & username
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

// ============================================================
//  MODAL HELPERS
// ============================================================
function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// ============================================================
//  GOOGLE DRIVE — Fetch & Render Playlist
// ============================================================
async function fetchSongsFromDrive() {
    const listEl = document.getElementById('playlist-ui');
    listEl.innerHTML = '<li class="playlist-loading">Memuat lagu...</li>';

    try {
        // Ambil semua file audio dari Drive (mp3, flac, m4a, ogg, wav)
        const mimeTypes = [
            'audio/mpeg',
            'audio/flac',
            'audio/mp4',
            'audio/ogg',
            'audio/wav',
            'audio/x-wav',
        ].map(m => `mimeType="${m}"`).join(' or ');

        const query    = encodeURIComponent(mimeTypes);
        const fields   = 'files(id,name,mimeType,size)';
        const url      = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&pageSize=200&orderBy=name`;

        const res  = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await res.json();

        if (data.error) {
            throw new Error(data.error.message);
        }

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
    const listEl = document.getElementById('playlist-ui');
    listEl.innerHTML = playlist.map((file, idx) => `
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
//  PLAYER — Play, Prev, Next
// ============================================================
async function playSong(idx) {
    if (idx < 0 || idx >= playlist.length) return;

    currentIdx = idx;
    const file = playlist[idx];
    const songEl = document.getElementById('current-song');
    const player = document.getElementById('audio-player');

    // Update UI aktif
    document.querySelectorAll('#playlist-ui li').forEach(li => li.classList.remove('active'));
    const trackEl = document.getElementById(`track-${idx}`);
    if (trackEl) {
        trackEl.classList.add('active');
        trackEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    songEl.textContent = '⏳ Memuat: ' + file.name.replace(/\.[^.]+$/, '');

    try {
        // Stream langsung via blob untuk kompatibilitas luas
        const res  = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        const prev = player.src;

        player.src = URL.createObjectURL(blob);
        player.play();
        songEl.textContent = '▶ ' + file.name.replace(/\.[^.]+$/, '');

        // Bebaskan URL lama dari memory
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);

    } catch (err) {
        console.error('Playback error:', err);
        songEl.textContent = '⚠ Gagal memutar: ' + file.name;
    }
}

function prevSong() {
    if (playlist.length === 0) return;
    const idx = currentIdx <= 0 ? playlist.length - 1 : currentIdx - 1;
    playSong(idx);
}

function nextSong() {
    if (playlist.length === 0) return;
    const idx = currentIdx >= playlist.length - 1 ? 0 : currentIdx + 1;
    playSong(idx);
}

// Auto-next saat lagu habis
document.getElementById('audio-player').addEventListener('ended', () => {
    nextSong();
});

// ============================================================
//  REQUEST LAGU
// ============================================================
function sendRequest() {
    const input = document.getElementById('song-request');
    const song  = input.value.trim();
    if (!song) return;

    // Kirim request ke GAS (jika sudah dikonfigurasi)
    if (CONFIG.GAS_ENDPOINT.includes('GANTI')) {
        alert(`Request "${song}" dicatat! Admin akan menambahkan dalam 1×24 jam.`);
    } else {
        fetch(`${CONFIG.GAS_ENDPOINT}?action=songRequest&song=${encodeURIComponent(song)}&email=${encodeURIComponent(userEmail || '')}`)
            .catch(() => {}); // Fire and forget
        alert(`Request "${song}" terkirim! ✅`);
    }

    input.value = '';
}
