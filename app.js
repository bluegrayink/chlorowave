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

// State Global
let currentUser = null;
let playlist = [];
let currentIndex = -1;
let isShuffle = false;
let repeatMode = 0; // 0: No Repeat, 1: Repeat One, 2: Repeat All

const audio = new Audio();

/* ==============================================
   FUNGSI NAVIGASI & UI
============================================== */
function navTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(`screen-${screenId}`).classList.remove('hidden');
    window.scrollTo(0,0);
}

/* ==============================================
   LOGIKA PENDAFTARAN & PEMBAYARAN
============================================== */
async function handleRegistration() {
    const emailInput = document.getElementById('reg-email');
    const btnPay = document.getElementById('btn-pay');
    const errorDiv = document.getElementById('reg-error');
    
    const email = emailInput.value.trim().toLowerCase();
    
    if (!email) {
        showRegError("Masukkan nama email Anda!");
        return;
    }

    const fullEmail = email + "@gmail.com";
    
    // UI Loading
    btnPay.disabled = true;
    btnPay.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menghubungkan...';
    errorDiv.classList.add('hidden');

    try {
        // 1. KIRIM DATA KE GOOGLE SHEETS (VIA GAS)
        // Menggunakan mode: 'no-cors' karena GAS sering bermasalah dengan CORS
        await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'register',
                email: fullEmail,
                username: email,
                status: 'pending'
            })
        });

        // 2. UPDATE WIDGET TEMANQRIS SECARA DINAMIS
        const qrisWidget = document.getElementById('qris-widget-element');
        qrisWidget.setAttribute('data-description', `ChloroWave-${fullEmail}`);
        
        // Update Tampilan Layar Pending
        document.getElementById('display-email').innerText = fullEmail;
        
        // 3. RENDER ULANG WIDGET & PINDAH LAYAR
        if (window.TemanQRIS) {
            window.TemanQRIS.render();
        }
        
        navTo('pending');
        
        // 4. MULAI CEK STATUS PEMBAYARAN (POLLING)
        startPaymentPolling(fullEmail);

    } catch (error) {
        console.error("Registration error:", error);
        showRegError("Gagal terhubung ke server. Coba lagi.");
        btnPay.disabled = false;
        btnPay.innerText = "Bayar Sekarang";
    }
}

function showRegError(msg) {
    const errorDiv = document.getElementById('reg-error');
    errorDiv.innerText = msg;
    errorDiv.classList.remove('hidden');
}

/* ==============================================
   CEK STATUS PEMBAYARAN (POLLING)
============================================== */
function startPaymentPolling(email) {
    const checkInterval = setInterval(async () => {
        try {
            const response = await fetch(`${SCRIPT_URL}?action=checkWhitelist&email=${email}`);
            const result = await response.json();

            if (result.status === 'active') {
                clearInterval(checkInterval);
                currentUser = { email: email, username: result.username };
                initApp(); // Masuk ke aplikasi
            }
        } catch (e) {
            console.log("Polling status...");
        }
    }, 5000); // Cek setiap 5 detik
}

/* ==============================================
   LOGIKA PLAYER MUSIK
============================================== */
function initApp() {
    navTo('app');
    document.getElementById('user-display-name').innerText = currentUser.username;
    refreshPlaylist();
}

async function refreshPlaylist() {
    const playlistUI = document.getElementById('playlist-ui');
    playlistUI.innerHTML = '<li class="playlist-loading">Memuat musik dari Drive...</li>';
    
    try {
        const res = await fetch(`${SCRIPT_URL}?action=getPlaylist&email=${currentUser.email}`);
        const data = await res.json();
        
        if (data.length === 0) {
            playlistUI.innerHTML = '<li class="playlist-empty">Folder musik kosong / tidak ditemukan.</li>';
            return;
        }

        playlist = data;
        renderPlaylist();
    } catch (e) {
        playlistUI.innerHTML = '<li class="playlist-error">Gagal memuat playlist.</li>';
    }
}

function renderPlaylist() {
    const playlistUI = document.getElementById('playlist-ui');
    playlistUI.innerHTML = '';

    playlist.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = (index === currentIndex) ? 'track-active' : '';
        li.innerHTML = `
            <div class="track-icon"><i class="fa-solid fa-play"></i></div>
            <div class="track-info">
                <div class="track-name">${track.name}</div>
            </div>
        `;
        li.onclick = () => playTrack(index);
        playlistUI.appendChild(li);
    });
}

function playTrack(index) {
    if (index < 0 || index >= playlist.length) return;
    
    currentIndex = index;
    const track = playlist[index];
    
    audio.src = track.url;
    audio.play();
    
    // Update UI
    document.getElementById('track-title').innerText = track.name;
    document.getElementById('play-icon').className = 'fa-solid fa-pause';
    renderPlaylist();
}

function togglePlay() {
    if (audio.paused) {
        audio.play();
        document.getElementById('play-icon').className = 'fa-solid fa-pause';
    } else {
        audio.pause();
        document.getElementById('play-icon').className = 'fa-solid fa-play';
    }
}

/* ==============================================
   AUDIO EVENTS
============================================== */
audio.ontimeupdate = () => {
    const progress = (audio.currentTime / audio.duration) * 100;
    document.getElementById('progress-bar').style.width = `${progress}%`;
    
    // Update Time
    document.getElementById('time-current').innerText = formatTime(audio.currentTime);
    document.getElementById('time-duration').innerText = formatTime(audio.duration || 0);
};

audio.onended = () => {
    if (repeatMode === 1) {
        audio.play();
    } else {
        nextTrack();
    }
};

function formatTime(secs) {
    const min = Math.floor(secs / 60);
    const sec = Math.floor(secs % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

function nextTrack() {
    let nextIndex = currentIndex + 1;
    if (isShuffle) nextIndex = Math.floor(Math.random() * playlist.length);
    if (nextIndex >= playlist.length) nextIndex = 0;
    playTrack(nextIndex);
}

function prevTrack() {
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) prevIndex = playlist.length - 1;
    playTrack(prevIndex);
}

/* ==============================================
   PENGATURAN USER
============================================== */
function toggleUserMenu() {
    // Logika logout atau ganti nama bisa ditaruh di sini
    if(confirm("Apakah Anda ingin logout?")) {
        location.reload();
    }
}

// Inisialisasi awal saat halaman dimuat
window.onload = () => {
    // Jika ingin auto-login bisa cek localStorage di sini
};
