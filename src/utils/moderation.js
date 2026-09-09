const log = require('./logger');

const groupMessageHistory = {};

// ─── Cooldown Registry ──────────────────────────────────────────────────────
// Mencegah spam balasan penolakan ke member yang berulang kali tag bot
const cooldownMap = new Map();

/**
 * Mengecek apakah sebuah ID (JID) masih dalam masa cooldown.
 * Return true jika boleh merespons (cooldown sudah lewat atau belum pernah).
 * Return false jika masih dalam cooldown (jangan respons).
 */
function checkCooldown(id, cooldownMs = 30000) {
    const now = Date.now();
    const lastTime = cooldownMap.get(id) || 0;
    if (now - lastTime < cooldownMs) {
        return false; // Masih dalam cooldown
    }
    cooldownMap.set(id, now);
    return true; // Cooldown sudah lewat, boleh respons
}

/**
 * Membersihkan entri cooldown yang sudah kedaluwarsa (> 5 menit).
 * Dipanggil secara periodik untuk mencegah memory leak.
 */
function cleanupCooldowns() {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 menit
    for (const [id, timestamp] of cooldownMap.entries()) {
        if (now - timestamp > maxAge) {
            cooldownMap.delete(id);
        }
    }
}

// Bersihkan cooldown setiap 5 menit
setInterval(cleanupCooldowns, 5 * 60 * 1000);

// ─── Moderasi Pesan ─────────────────────────────────────────────────────────

// Pattern yang dilarang (bisa diperluas)
const BLOCKED_PATTERNS = [
    { pattern: /https?:\/\//i, reason: 'Tautan HTTP/HTTPS terdeteksi dan dilarang di grup ini.' },
    { pattern: /chat\.whatsapp\.com\//i, reason: 'Tautan undangan grup WhatsApp terdeteksi dan dilarang.' }
];

function checkMessageModeration(messageText, isOwner) {
    if (isOwner) return { safe: true };

    for (const { pattern, reason } of BLOCKED_PATTERNS) {
        if (pattern.test(messageText)) {
            log.info('MODERATION', `Terdeteksi pelanggaran: ${reason}`);
            return { safe: false, reason };
        }
    }

    return { safe: true };
}

function getGroupActivitySummary(remoteJid) {
    log.info('ANALYTICS', `Meringkas aktivitas percakapan untuk grup: ${remoteJid}`);
    const history = groupMessageHistory[remoteJid] || [];
    if (history.length === 0) return "Belum ada catatan aktivitas percakapan yang terekam di grup ini.";

    // Hitung pengirim unik
    const senderCounts = {};
    for (const entry of history) {
        const match = entry.match(/^Sender: ([^ ]+)/);
        if (match) {
            senderCounts[match[1]] = (senderCounts[match[1]] || 0) + 1;
        }
    }

    const topSenders = Object.entries(senderCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([sender, count], idx) => `${idx + 1}. ${sender.split('@')[0]} (${count} pesan)`)
        .join('\n');

    return [
        `📊 *Ringkasan Aktivitas Grup*:`,
        `- Total Pesan Tersimpan di Memori: ${history.length}`,
        `- Pengirim Unik: ${Object.keys(senderCounts).length}`,
        '',
        `*Top Pengirim:*`,
        topSenders,
        '',
        `*Cuplikan Diskusi Terakhir:*`,
        history.slice(-10).join('\n')
    ].join('\n');
}

module.exports = {
    groupMessageHistory,
    checkMessageModeration,
    getGroupActivitySummary,
    checkCooldown
};
