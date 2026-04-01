// ============================================================
//  CHLOROWAVE — Google Apps Script (gas-script.js)
//
//  CARA DEPLOY:
//  1. Buka script.google.com → New Project
//  2. Paste seluruh kode ini
//  3. Ganti SPREADSHEET_ID dan SHEET_NAME di CONFIG
//  4. Klik "Deploy" → "New deployment" → Type: Web App
//  5. Execute as: Me | Who has access: Anyone
//  6. Copy URL deployment → paste ke CONFIG.GAS_ENDPOINT di app.js
//
//  STRUKTUR GOOGLE SHEET:
//  Kolom A: Timestamp (auto dari Google Form)
//  Kolom B: Email Gmail
//  Kolom C: Link Share
//  Kolom D: Nomor Referensi
//  Kolom E: Status (isi manual: "active" atau "pending")
//  Kolom F: Catatan Admin (opsional)
// ============================================================

const CONFIG = {
    SPREADSHEET_ID: 'GANTI_DENGAN_ID_SPREADSHEET_KAMU',
    // ID ada di URL Sheets: docs.google.com/spreadsheets/d/[INI_YANG_DICOPY]/edit

    SHEET_NAME: 'Responses', // Nama sheet (biasanya "Form Responses 1" atau "Responses")

    // Kolom (0-indexed): sesuaikan jika urutan kolom di Sheet berbeda
    COL_EMAIL:  1,  // Kolom B = index 1
    COL_STATUS: 4,  // Kolom E = index 4

    // Email admin untuk notifikasi tambahan (opsional, Google Form sudah kirim notif)
    ADMIN_EMAIL: 'emailadmin@gmail.com',

    // Nama pengirim email ke user
    EMAIL_SENDER_NAME: 'ChloroWave',
};

// ============================================================
//  MAIN HANDLER — Semua request masuk ke sini
// ============================================================
function doGet(e) {
    const action = e.parameter.action;

    // CORS headers
    const output = ContentService.createTextOutput();
    output.setMimeType(ContentService.MimeType.JSON);

    try {
        let result;

        if (action === 'checkWhitelist') {
            result = checkWhitelist(e.parameter.email);
        } else if (action === 'songRequest') {
            result = logSongRequest(e.parameter.song, e.parameter.email);
        } else {
            result = { ok: true, msg: 'ChloroWave API running' };
        }

        output.setContent(JSON.stringify(result));

    } catch (err) {
        output.setContent(JSON.stringify({ error: err.message }));
    }

    return output;
}

// ============================================================
//  FUNGSI 1: Cek apakah email ada di whitelist dengan status "active"
// ============================================================
function checkWhitelist(email) {
    if (!email) return { active: false, reason: 'no_email' };

    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
        .getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) return { active: false, reason: 'sheet_not_found' };

    const data = sheet.getDataRange().getValues();

    // Skip header row (index 0), cari dari baris 1
    for (let i = 1; i < data.length; i++) {
        const rowEmail  = (data[i][CONFIG.COL_EMAIL]  || '').toString().toLowerCase().trim();
        const rowStatus = (data[i][CONFIG.COL_STATUS] || '').toString().toLowerCase().trim();

        if (rowEmail === email.toLowerCase().trim()) {
            return {
                active: rowStatus === 'active',
                status: rowStatus,
                row: i + 1  // untuk debugging (1-indexed)
            };
        }
    }

    return { active: false, status: 'not_found' };
}

// ============================================================
//  FUNGSI 2: Log song request ke sheet terpisah
// ============================================================
function logSongRequest(song, email) {
    if (!song) return { ok: false };

    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    let sheet = ss.getSheetByName('Song Requests');

    // Buat sheet jika belum ada
    if (!sheet) {
        sheet = ss.insertSheet('Song Requests');
        sheet.getRange(1, 1, 1, 4).setValues([['Timestamp', 'Email', 'Request', 'Status']]);
    }

    sheet.appendRow([
        new Date().toLocaleString('id-ID'),
        email || 'unknown',
        song,
        'pending'
    ]);

    return { ok: true };
}

// ============================================================
//  FUNGSI 3: Kirim email ke user saat status diubah jadi "active"
//  Jalankan fungsi ini sebagai TRIGGER: On Edit di Spreadsheet
//
//  CARA SETUP TRIGGER:
//  1. Di Apps Script editor → Klik ikon jam (Triggers)
//  2. Add Trigger → Function: onStatusChange
//  3. Event source: From Spreadsheet | Event type: On edit
//  4. Save
// ============================================================
function onStatusChange(e) {
    const sheet = e.source.getActiveSheet();

    // Hanya proses di sheet utama
    if (sheet.getName() !== CONFIG.SHEET_NAME) return;

    const range = e.range;
    const col   = range.getColumn();
    const row   = range.getRow();

    // Hanya proses jika kolom Status yang diedit (COL_STATUS + 1 karena 1-indexed)
    if (col !== CONFIG.COL_STATUS + 1) return;
    if (row <= 1) return; // Skip header

    const newValue = range.getValue().toString().toLowerCase().trim();
    if (newValue !== 'active') return; // Hanya proses saat diubah jadi "active"

    // Ambil email dari kolom B
    const emailCell = sheet.getRange(row, CONFIG.COL_EMAIL + 1);
    const userEmail = emailCell.getValue().toString().trim();

    if (!userEmail || !userEmail.includes('@')) return;

    // Kirim email notifikasi ke user
    sendActivationEmail(userEmail);

    // Log di kolom Catatan Admin
    sheet.getRange(row, CONFIG.COL_STATUS + 2).setValue(
        'Email aktivasi dikirim: ' + new Date().toLocaleString('id-ID')
    );
}

function sendActivationEmail(userEmail) {
    const subject = '✅ Akun ChloroWave Kamu Sudah Aktif!';

    const body = `
Halo!

Kabar baik — akun ChloroWave kamu sudah diverifikasi dan siap digunakan.

Cara login:
1. Buka ChloroWave di browser kamu
2. Klik tombol "Sudah punya akun? Login"
3. Login dengan Gmail ini: ${userEmail}
4. Selesai! Musik dari Google Drive kamu langsung bisa diputar.

Terima kasih sudah mendukung ChloroWave! 🎵

—
Tim ChloroWave
`.trim();

    const htmlBody = `
<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #333;">
    <div style="background: #0a0a0a; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #1DB954; font-size: 1.4rem; margin: 0;">ChloroWave</h1>
        <p style="color: #666; font-size: 0.8rem; margin: 4px 0 0;">MP3 Player Pribadi</p>
    </div>
    <div style="background: #141414; padding: 32px; border-radius: 0 0 12px 12px;">
        <h2 style="color: #fff; font-size: 1.2rem;">Akun Kamu Sudah Aktif! 🎉</h2>
        <p style="color: #aaa; line-height: 1.7;">
            Verifikasi selesai. Kamu sekarang bisa login dan menikmati musik dari Google Drive pribadi kamu.
        </p>
        <div style="background: #1e1e1e; border-radius: 10px; padding: 16px; margin: 20px 0;">
            <p style="color: #666; font-size: 0.8rem; margin: 0 0 6px;">Login dengan email:</p>
            <p style="color: #1DB954; font-family: monospace; font-size: 1rem; margin: 0;">${userEmail}</p>
        </div>
        <ol style="color: #aaa; line-height: 2; padding-left: 20px;">
            <li>Buka ChloroWave di browser</li>
            <li>Klik <strong style="color: #fff;">"Sudah punya akun? Login"</strong></li>
            <li>Login dengan Gmail ini</li>
            <li>Selesai — putar musikmu! 🎵</li>
        </ol>
    </div>
    <p style="color: #555; font-size: 0.78rem; text-align: center; margin-top: 16px;">
        Email ini dikirim otomatis oleh sistem ChloroWave.
    </p>
</div>
`.trim();

    GmailApp.sendEmail(userEmail, subject, body, {
        name:     CONFIG.EMAIL_SENDER_NAME,
        htmlBody: htmlBody
    });
}

// ============================================================
//  FUNGSI 4: Test — jalankan manual dari editor untuk cek
// ============================================================
function testCheckWhitelist() {
    const result = checkWhitelist('test@gmail.com');
    Logger.log(JSON.stringify(result));
}

function testSendEmail() {
    sendActivationEmail('test@gmail.com');
    Logger.log('Email terkirim ke test@gmail.com');
}
