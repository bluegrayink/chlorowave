let accessToken = null;
const playlistUI = document.getElementById('playlist-ui');
const audioPlayer = document.getElementById('audio-player');

// 1. Inisialisasi Google Login
document.getElementById('login-btn').addEventListener('click', () => {
    const client = google.accounts.oauth2.initTokenClient({
        client_id: '56742945749-gm2otrtbtqilaquo4rt54hk59v80ld1h.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/drive.readonly', // Hanya akses file yang dibuat aplikasi ini
        callback: (response) => {
            accessToken = response.access_token;
            fetchSongsFromDrive();
        },
    });
    client.requestAccessToken();
});

// 2. Simulasi Request Lagu (Kirim ke Backend kamu)
function sendRequest() {
    const song = document.getElementById('song-request').value;
    if (song) {
        alert(`Request "${song}" diterima. Kami akan upload ke Drive Anda dalam 1x24 jam.`);
        document.getElementById('song-request').value = "";
    }
}

// 3. Ambil List Lagu dari Folder Google Drive
async function fetchSongsFromDrive() {
    console.log("Mulai mengambil lagu dengan token:", accessToken); // Tambahkan ini
    try {
        const response = await fetch('https://www.googleapis.com/drive/v3/files?q=mimeType="audio/mpeg"&fields=files(id, name)', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await response.json();
        console.log("Data dari Google Drive:", data); // Lihat hasilnya di console nanti

        if (data.files && data.files.length > 0) {
            renderPlaylist(data.files);
        } else {
            console.log("Tidak ada file MP3 ditemukan di Drive.");
            playlistUI.innerHTML = "<li>Gagal menemukan lagu. Pastikan ada file MP3 di Drive Anda.</li>";
        }
    } catch (err) {
        console.error("Error saat fetch lagu:", err);
    }
}

function renderPlaylist(files) {
    playlistUI.innerHTML = files.map(file => `
        <li>
            <span onclick="playSong('${file.id}', '${file.name}')">🎵 ${file.name}</span>
            <button onclick="deleteSong('${file.id}')">❌</button>
        </li>
    `).join('');
}

// 4. Putar Musik Langsung dari GDrive
function playSong(fileId, fileName) {
    document.getElementById('current-song').innerText = fileName;
    // URL streaming langsung dari Google Drive
    audioPlayer.src = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&access_token=${accessToken}`;
    audioPlayer.play();

    // Media Session API untuk Background Running & Control Lockscreen
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: fileName,
            artist: 'CloudMusic User',
            album: 'My Private Collection'
        });
    }
}
