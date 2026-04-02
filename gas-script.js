// ============================================================
//  CHLOROWAVE — Google Apps Script
//  Paste seluruh kode ini ke Apps Script yang terhubung ke Spreadsheet
// ============================================================

const CONFIG = {
    SPREADSHEET_ID: '1Z1DF4rvtyPIseW22yU16syMJp6KNM-pEPjGncQyxBnE',
    SHEET_NAME: 'Form Responses 1',
    COL_EMAIL:  2,  // Kolom C = index 2
    COL_STATUS: 5,  // Kolom F = index 5
    ADMIN_EMAIL: 'alber7zone@gmail.com',
    EMAIL_SENDER_NAME: 'ChloroWave',
};

// ============================================================
//  MAIN HANDLER
// ============================================================
function doGet(e) {
    const action = e.parameter.action;
    const output = ContentService.createTextOutput();
    output.setMimeType(ContentService.MimeType.JSON);

    try {
        let result;

        if (action === 'checkWhitelist') {
            result = checkWhitelist(e.parameter.email);
        } else if (action === 'register') {
            result = registerUser(e.parameter.email, e.parameter.shareUrl, e.parameter.refNum);
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
//  FUNGSI 1: Registrasi user baru — simpan ke Sheet
// ============================================================
function registerUser(email, shareUrl, refNum) {
    if (!email) return { ok: false, reason: 'no_email' };

    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
        .getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) return { ok: false, reason: 'sheet_not_found' };

    sheet.appendRow([
        new Date().toLocaleString('id-ID'),  // A: Timestamp
        '',                                   // B: Email Address (kosong)
        email,                                // C: Email Gmail
        shareUrl || '',                       // D: Link Share
        refNum   || '',                       // E: Nomor Referensi
        'pending',                            // F: Status
        ''                                    // G: Catatan Admin
    ]);

    return { ok: true };
}

// ============================================================
//  FUNGSI 2: Cek whitelist
// ============================================================
function checkWhitelist(email) {
    if (!email) return { active: false, reason: 'no_email' };

    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
        .getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) return { active: false, reason: 'sheet_not_found' };

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        const rowEmail  = (data[i][CONFIG.COL_EMAIL]  || '').toString().toLowerCase().trim();
        const rowStatus = (data[i][CONFIG.COL_STATUS] || '').toString().toLowerCase().trim();

        if (rowEmail === email.toLowerCase().trim()) {
            return {
                active: rowStatus === 'active',
                status: rowStatus,
                row: i + 1
            };
        }
    }

    return { active: false, status: 'not_found' };
}

// ============================================================
//  FUNGSI 3: Log song request
// ============================================================
function logSongRequest(song, email) {
    if (!song) return { ok: false };

    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    let sheet = ss.getSheetByName('Song Requests');

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
//  FUNGSI 4: Trigger — kirim email saat status diubah jadi "active"
//  Setup: Triggers → Add Trigger → onStatusChange → From Spreadsheet → On edit
// ============================================================
function onStatusChange(e) {
    const sheet = e.source.getActiveSheet();
    if (sheet.getName() !== CONFIG.SHEET_NAME) return;

    const range = e.range;
    const col   = range.getColumn();
    const row   = range.getRow();

    if (col !== CONFIG.COL_STATUS + 1) return;
    if (row <= 1) return;

    const newValue = range.getValue().toString().toLowerCase().trim();
    if (newValue !== 'active') return;

    const emailCell = sheet.getRange(row, CONFIG.COL_EMAIL + 1);
    const userEmail = emailCell.getValue().toString().trim();

    if (!userEmail || !userEmail.includes('@')) return;

    sendActivationEmail(userEmail);

    sheet.getRange(row, CONFIG.COL_STATUS + 2).setValue(
        'Email aktivasi dikirim: ' + new Date().toLocaleString('id-ID')
    );
}

function sendActivationEmail(userEmail) {
    const subject = '✅ Akun ChloroWave Kamu Sudah Aktif!';

    const body = `
Halo!

Akun ChloroWave kamu sudah diverifikasi dan siap digunakan.

Cara login:
1. Buka ChloroWave di browser kamu
2. Klik tombol "Sudah punya akun? Login"
3. Login dengan Gmail ini: ${userEmail}
4. Selesai! Musik dari Google Drive kamu langsung bisa diputar.

Terima kasih sudah mendukung ChloroWave! 🎵

— Tim ChloroWave
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
            Verifikasi selesai. Kamu sekarang bisa login dan menikmati musik dari Google Drive kamu.
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
</div>`.trim();

    GmailApp.sendEmail(userEmail, subject, body, {
        name:     CONFIG.EMAIL_SENDER_NAME,
        htmlBody: htmlBody
    });
}

// ============================================================
//  TEST — jalankan manual dari editor
// ============================================================
function testRegister() {
    const result = registerUser('test@gmail.com', 'https://threads.net/test', 'TRF123TEST');
    Logger.log(JSON.stringify(result));
}

function testCheckWhitelist() {
    const result = checkWhitelist('test@gmail.com');
    Logger.log(JSON.stringify(result));
}

function testSendEmail() {
    sendActivationEmail('alber7zone@gmail.com');
    Logger.log('Email terkirim');
}
