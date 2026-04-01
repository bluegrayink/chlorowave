let accessToken = null;
const playlistUI = document.getElementById('playlist-ui');
const audioPlayer = document.getElementById('audio-player');

// --- LOGIKA AKTIVASI & MODAL ---

// Fungsi buka modal
function openModal() {
    document.getElementById('activation-modal').classList.remove('hidden');
}

// Fungsi tutup modal
function closeModal() {
    document.getElementById('activation-modal').classList.add('hidden');
}

// Handle Form Aktivasi saat disubmit
document.getElementById('activation-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    // Ambil data (Bisa kamu kembangkan untuk kirim ke database/email nanti)
    const userData = {
        email: document.getElementById('user-email').value,
        shareLink: document.getElementById('share-link').value,
        payment: document.getElementById('pay-note').value
    };

    console.log("User teraktivasi:", userData);

    // Simpan status di browser agar tidak muncul lagi modalnya
    localStorage.setItem('chlorowave_activated', 'true');
    
    closeModal();
    alert("Aktivasi Berhasil! Sekarang hubungkan ke Google Drive Anda.");
    
    // Langsung pancing login Google setelah klik submit
    startGoogleLogin();
});

// --- LOGIKA AUTH GOOGLE ---

// Tombol Login Utama
document.getElementById('login-btn').addEventListener('click', () => {
    // Cek apakah sudah aktivasi atau belum
    if (localStorage.getItem('chlorowave_activated') === 'true') {
        startGoogleLogin();
    } else {
        openModal();
    }
});

function startGoogleLogin() {
    const client = google.accounts.oauth2.initTokenClient({
        client_id: '56742945749-gm2otrtbtqilaquo4rt54hk59v80ld1h.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        callback: async (response) => {
            accessToken = response.access_token;
            if (accessToken) {
                await fetchUserInfo();
                fetchSongsFromDrive();
                showUserProfileUI();
            }
        },
    });
    client.requestAccessToken();
}

async function fetchUserInfo() {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const user = await res.json();
        const defaultName = user.email.split('@')[0];
        
        if (!localStorage.getItem('chlorowave_username')) {
            localStorage.setItem('chlorowave_username', defaultName);
        }
        updateUsernameUI();
    } catch (err) {
        console.error("Gagal ambil info user:", err);
    }
}

function updateUsernameUI() {
    const savedName = localStorage.getItem('chlorowave_username') || "User";
    document.getElementById('username-display').innerText = "👤 " + savedName;
}

function showUserProfileUI() {
    document.getElementById('login-btn').classList.add('hidden');
    document.getElementById('user-profile').classList.remove('hidden');
}

function toggleUserMenu() {
    document.getElementById('user-menu').classList.toggle('hidden');
}

function saveUsername() {
    const newName = document.getElementById('edit-username-input').value;
    if (newName.trim() !== "") {
        localStorage.setItem('chlorowave_username', newName);
        updateUsernameUI();
        document.getElementById('edit-username-input').value = "";
        toggleUserMenu();
    }
}

function logout() {
    if (confirm("Logout dan reset aktivasi?")) {
        accessToken = null;
        localStorage.clear(); // Hapus status aktivasi & username
        location.reload();
    }
}

// --- LOGIKA DRIVE & PLAYER ---

async function fetchSongsFromDrive() {
    try {
        const response = await fetch('https://www.googleapis.com/drive/v3/files?q=mimeType="audio/mpeg"&fields=files(id, name)', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await response.json();
        if (data.files && data.files.length > 0) {
            renderPlaylist(data.files);
        } else {
            playlistUI.innerHTML = "<li>Folder Drive kosong. Silakan upload MP3 dulu.</li>";
        }
    } catch (err) {
        console.error("Error fetch lagu:", err);
    }
}

function renderPlaylist(files) {
    playlistUI.innerHTML = files.map(file => `
        <li>
            <span onclick="playSong('${file.id}', '${file.name}')">🎵 ${file.name}</span>
        </li>
    `).join('');
}

async function playSong(fileId, fileName) {
    const currentSongEl = document.getElementById('current-song');
    currentSongEl.innerText = "Memuat: " + fileName;

    try {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const blob = await response.blob();
        audioPlayer.src = URL.createObjectURL(blob);
        audioPlayer.play();
        currentSongEl.innerText = fileName;
    } catch (err) {
        console.error("Gagal putar:", err);
    }
}

function sendRequest() {
    const song = document.getElementById('song-request').value;
    if (song) {
        alert(`Request "${song}" sudah masuk antrean!`);
        document.getElementById('song-request').value = "";
    }
}
