let accessToken = null;
const playlistUI = document.getElementById('playlist-ui');
const audioPlayer = document.getElementById('audio-player');

// 1. Inisialisasi Google Login & Profile
document.getElementById('login-btn').addEventListener('click', () => {
    const client = google.accounts.oauth2.initTokenClient({
        client_id: '56742945749-gm2otrtbtqilaquo4rt54hk59v80ld1h.apps.googleusercontent.com',
        // Scope ditambah: drive.readonly + userinfo.profile + userinfo.email
        scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        callback: async (response) => {
            accessToken = response.access_token;
            if (accessToken) {
                await fetchUserInfo();   // Ambil nama dari Google
                fetchSongsFromDrive();   // Ambil lagu
                showUserProfileUI();     // Sembunyikan login, munculkan profil
            }
        },
    });
    client.requestAccessToken();
});

// 2. Ambil Info User dari Google
async function fetchUserInfo() {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const user = await res.json();
        
        // Default username diambil dari bagian depan email
        const defaultName = user.email.split('@')[0];
        
        // Simpan ke LocalStorage jika belum ada nama custom sebelumnya
        if (!localStorage.getItem('chlorowave_username')) {
            localStorage.setItem('chlorowave_username', defaultName);
        }
        updateUsernameUI();
    } catch (err) {
        console.error("Gagal mengambil info user:", err);
    }
}

// 3. Update Tampilan Nama & UI
function updateUsernameUI() {
    const savedName = localStorage.getItem('chlorowave_username') || "User";
    document.getElementById('username-display').innerText = "👤 " + savedName;
}

function showUserProfileUI() {
    document.getElementById('login-btn').classList.add('hidden');
    document.getElementById('user-profile').classList.remove('hidden');
}

function toggleUserMenu() {
    const menu = document.getElementById('user-menu');
    menu.classList.toggle('hidden');
}

function saveUsername() {
    const newName = document.getElementById('edit-username-input').value;
    if (newName.trim() !== "") {
        localStorage.setItem('chlorowave_username', newName);
        updateUsernameUI();
        document.getElementById('edit-username-input').value = "";
        toggleUserMenu();
        alert("Nama berhasil diperbarui!");
    }
}

// 4. Logout (Reset semua & refresh)
function logout() {
    if (confirm("Logout dari Chlorowave?")) {
        accessToken = null;
        localStorage.removeItem('chlorowave_username');
        location.reload(); // Refresh halaman untuk membersihkan data
    }
}

// 5. Ambil List Lagu dari Google Drive
async function fetchSongsFromDrive() {
    console.log("Mencari file MP3...");
    try {
        const response = await fetch('https://www.googleapis.com/drive/v3/files?q=mimeType="audio/mpeg"&fields=files(id, name)', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await response.json();

        if (data.files && data.files.length > 0) {
            renderPlaylist(data.files);
        } else {
            playlistUI.innerHTML = "<li>Tidak ada MP3. Silakan upload ke Drive Anda.</li>";
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

// 6. Fungsi Putar Musik (Blob Method)
async function playSong(fileId, fileName) {
    const currentSongEl = document.getElementById('current-song');
    currentSongEl.innerText = "Memuat: " + fileName + "...";

    try {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!response.ok) throw new Error("Gagal ambil file");

        const blob = await response.blob();
        const musicUrl = URL.createObjectURL(blob);

        audioPlayer.src = musicUrl;
        audioPlayer.play();
        
        currentSongEl.innerText = fileName;

        // Kontrol Lockscreen
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: fileName,
                artist: 'Chlorowave Premium',
                album: 'My Cloud Collection'
            });
        }
    } catch (err) {
        console.error("Gagal putar:", err);
        currentSongEl.innerText = "Error memutar lagu.";
    }
}

// Fitur Tambahan: Request Lagu (Opsional)
function sendRequest() {
    const song = document.getElementById('song-request').value;
    if (song) {
        alert(`Request "${song}" diterima!`);
        document.getElementById('song-request').value = "";
    }
}
