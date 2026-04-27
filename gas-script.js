// ============================================================
//  CHLOROWAVE — Google Apps Script
//  Paste ke Apps Script yang terhubung ke Google Sheet
//  Login: cs.chlorowave@gmail.com
//
//  STRUKTUR SHEET (setelah kolom Email Address dihapus):
//  A: Timestamp
//  B: Email Gmail     → COL_EMAIL = 1
//  C: Link Share
//  D: Nomor Referensi
//  E: Status          → COL_STATUS = 4
//  F: Catatan Admin
// ============================================================

const CONFIG = {
    SPREADSHEET_ID:    '1xuyKqv3LMemxOVcci8T9AIY34AgcLEfI4ITmS4ILqzg',
    SHEET_NAME:        'Sheet1',
    COL_EMAIL:         1,  // Kolom B = index 1
    COL_STATUS:        4,  // Kolom E = index 4
    ADMIN_EMAIL:       'cs.chlorowave@gmail.com',
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
        } else if (action === 'paymentWebhook') {
            result = handlePaymentWebhook(e);
        } else if (action === 'songRequest') {
            result = logSongRequest(e.parameter.song, e.parameter.email);
        } else if (action === 'paymentWebhook') {
            // Webhook dari Temanqris via GET (fallback)
            result = { ok: true, msg: 'Use POST for webhook' };
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
//  POST HANDLER — untuk webhook POST dari Temanqris
// ============================================================
function doPost(e) {
    const output = ContentService.createTextOutput();
    output.setMimeType(ContentService.MimeType.JSON);

    try {
        const body = JSON.parse(e.postData.contents);
        const result = processPaymentWebhook(body);
        output.setContent(JSON.stringify(result));
    } catch (err) {
        output.setContent(JSON.stringify({ error: err.message }));
    }

    return output;
}

// ============================================================
//  FUNGSI WEBHOOK: Proses notifikasi pembayaran dari Temanqris
// ============================================================
function handlePaymentWebhook(e) {
    // Untuk GET request (fallback)
    return { ok: true, msg: 'Use POST for webhook' };
}

function processPaymentWebhook(body) {
    // Body dari Temanqris: { event, order_id, amount, description, status, ... }
    // description berisi: "ChloroWave-email@gmail.com"

    const description = body.description || '';
    const status      = body.status      || '';
    const amount      = body.amount      || 0;

    // Ekstrak email dari description
    const emailMatch = description.match(/ChloroWave-(.+)/);
    if (!emailMatch) return { ok: false, reason: 'email_not_found_in_description' };

    const email = emailMatch[1].trim().toLowerCase();

    // Validasi pembayaran
    if (status !== 'paid' && status !== 'confirmed' && status !== 'settlement') {
        return { ok: false, reason: 'payment_not_confirmed', status };
    }

    // Update status di Sheet jadi 'paid' (menunggu verifikasi link share)
    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
        .getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) return { ok: false, reason: 'sheet_not_found' };

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        const rowEmail = (data[i][CONFIG.COL_EMAIL] || '').toString().toLowerCase().trim();
        if (rowEmail === email) {
            // Update kolom catatan admin dengan info pembayaran
            sheet.getRange(i + 1, CONFIG.COL_STATUS + 2).setValue(
                `Bayar via QRIS: Rp${amount} — ${new Date().toLocaleString('id-ID')}`
            );
            // Kirim notif ke admin
            notifyAdmin(email, amount);
            return { ok: true, email };
        }
    }

    return { ok: false, reason: 'email_not_registered' };
}

function notifyAdmin(email, amount) {
    try {
        GmailApp.sendEmail(
            CONFIG.ADMIN_EMAIL,
            `💰 Pembayaran ChloroWave — ${email}`,
            `Ada pembayaran QRIS masuk!

Email: ${email}
Nominal: Rp${amount}

Silakan verifikasi link share dan ubah status menjadi "active" di Google Sheet.`,
            { name: 'ChloroWave System' }
        );
    } catch(e) { /* silent fail */ }
}

// ============================================================
//  POST HANDLER — Temanqris Webhook
// ============================================================
function doPost(e) {
    const output = ContentService.createTextOutput();
    output.setMimeType(ContentService.MimeType.JSON);

    try {
        const payload = JSON.parse(e.postData.contents);
        const event   = payload.event || '';
        const desc    = payload.description || payload.order_description || '';
        const status  = payload.status || '';
        const amount  = payload.amount || 0;

        // Cek event pembayaran berhasil
        const isPaid = event === 'payment.confirmed' ||
                       event === 'payment.success' ||
                       status === 'confirmed' ||
                       status === 'success';

        if (!isPaid) {
            output.setContent(JSON.stringify({ ok: true, msg: 'Event ignored: ' + event }));
            return output;
        }

        // Cek nominal — harus >= 20000
        if (amount < 20000) {
            output.setContent(JSON.stringify({ ok: false, reason: 'amount_too_low' }));
            return output;
        }

        // Ekstrak email dari description (format: "ChloroWave-email@gmail.com")
        const emailMatch = desc.match(/ChloroWave-(.+@gmail\.com)/i);
        if (!emailMatch) {
            output.setContent(JSON.stringify({ ok: false, reason: 'email_not_found_in_description' }));
            return output;
        }

        const email = emailMatch[1].toLowerCase().trim();

        // Update status di Sheet jadi 'active'
        const result = activateUser(email);
        output.setContent(JSON.stringify(result));

    } catch (err) {
        output.setContent(JSON.stringify({ error: err.message }));
    }

    return output;
}

// ============================================================
//  Aktifkan user — ubah status pending → active + kirim email
// ============================================================
function activateUser(email) {
    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
        .getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) return { ok: false, reason: 'sheet_not_found' };

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        const rowEmail = (data[i][CONFIG.COL_EMAIL] || '').toString().toLowerCase().trim();
        if (rowEmail === email) {
            // Update status jadi active
            sheet.getRange(i + 1, CONFIG.COL_STATUS + 1).setValue('active');
            sheet.getRange(i + 1, CONFIG.COL_STATUS + 2).setValue(
                'Auto-aktivasi via QRIS: ' + new Date().toLocaleString('id-ID')
            );
            // Kirim email aktivasi
            sendActivationEmail(email);
            return { ok: true, email, activated: true };
        }
    }

    return { ok: false, reason: 'email_not_found' };
}

// ============================================================
//  FUNGSI 1: Registrasi user baru
// ============================================================
function registerUser(email, shareUrl, refNum) {
    if (!email) return { ok: false, reason: 'no_email' };

    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
        .getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) return { ok: false, reason: 'sheet_not_found' };

    sheet.appendRow([
        new Date().toLocaleString('id-ID'),  // A: Timestamp
        email,                                // B: Email Gmail
        shareUrl || '',                       // C: Link Share
        refNum   || '',                       // D: Nomor Referensi
        'pending',                            // E: Status
        ''                                    // F: Catatan Admin
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
                row:    i + 1
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
//  FUNGSI 4: Trigger — kirim email saat status diubah "active"
//  Setup: Triggers → Add Trigger → onStatusChange → From Spreadsheet → On edit
// ============================================================
function onStatusChange(e) {
    const sheet = e.source.getActiveSheet();
    if (sheet.getName() !== CONFIG.SHEET_NAME) return;

    const range = e.range;
    const col   = range.getColumn();
    const row   = range.getRow();

    // COL_STATUS + 1 karena getColumn() adalah 1-indexed
    if (col !== CONFIG.COL_STATUS + 1) return;
    if (row <= 1) return;

    const newValue = range.getValue().toString().toLowerCase().trim();
    if (newValue !== 'active') return;

    // Ambil email dari kolom B (COL_EMAIL + 1)
    const emailCell = sheet.getRange(row, CONFIG.COL_EMAIL + 1);
    const userEmail = emailCell.getValue().toString().trim();

    if (!userEmail || !userEmail.includes('@')) return;

    sendActivationEmail(userEmail);

    // Catat di kolom Catatan Admin (COL_STATUS + 2)
    sheet.getRange(row, CONFIG.COL_STATUS + 2).setValue(
        'Email aktivasi dikirim: ' + new Date().toLocaleString('id-ID')
    );
}

// ============================================================
//  EMAIL AKTIVASI
// ============================================================
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
//  TEST — jalankan manual dari editor untuk debugging
// ============================================================
function testRegister() {
    const result = registerUser('test@gmail.com', 'https://threads.net/test', 'TRF123');
    Logger.log(JSON.stringify(result));
}

function testCheckWhitelist() {
    const result = checkWhitelist('cs.bluegrayink@gmail.com');
    Logger.log(JSON.stringify(result));
}

function testSendEmail() {
    sendActivationEmail('cs.chlorowave@gmail.com');
    Logger.log('Email terkirim');
}
