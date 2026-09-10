const { normalizeMessageContent } = require('@whiskeysockets/baileys');

function extractMessageContent(msg, botInternalNumber) {
    if (!msg.message) return { text: null, mentionedJid: [], quotedMessageKey: null };
    const normalized = normalizeMessageContent(msg.message);
    if (!normalized) return { text: null, mentionedJid: [], quotedMessageKey: null };

    const text = normalized.conversation
        || normalized.extendedTextMessage?.text
        || normalized.imageMessage?.caption
        || normalized.videoMessage?.caption
        || normalized.documentMessage?.caption
        || null;

    const mentionedJid = normalized.extendedTextMessage?.contextInfo?.mentionedJid || [];
    
    let quotedMessageKey = null;
    const contextInfo = normalized.extendedTextMessage?.contextInfo;
    if (contextInfo && contextInfo.stanzaId) {
        const quotedParticipant = contextInfo.participant || msg.key.remoteJid;
        const quotedNum = quotedParticipant ? quotedParticipant.split('@')[0] : '';
        const { BOT_NUMBER, BOT_LID } = require('../config/env');
        const cleanBot = BOT_NUMBER ? BOT_NUMBER.replace(/[^0-9]/g, '') : '';
        const cleanLid = BOT_LID ? BOT_LID.replace(/[^0-9]/g, '') : '';
        
        quotedMessageKey = {
            remoteJid: msg.key.remoteJid,
            id: contextInfo.stanzaId,
            participant: quotedParticipant,
            fromMe: (botInternalNumber && quotedNum === botInternalNumber) || 
                    (cleanBot && quotedNum === cleanBot) || 
                    (cleanLid && quotedNum === cleanLid)
        };
    }

    return { text, mentionedJid, quotedMessageKey };
}

function cleanAiResponseForChat(text) {
    return text
        .replace(/\[AKSI:[^\]]+\]/gi, '')
        .replace(/STATUS:\s*LANJUT_FASE_BERIKUTNYA/gi, '')
        .replace(/STATUS:\s*LEWATI_AKSI/gi, '')
        .trim();
}

function formatFriendlyError(detail) {
    if (!detail) return 'Terdapat kendala pada sistem WhatsApp.';
    const lower = detail.toLowerCase();
    if (lower.includes('403') || lower.includes('admin') || lower.includes('forbidden') || lower.includes('not authorized')) {
        return 'Bot membutuhkan hak akses Admin grup untuk menjalankan tindakan ini.';
    }
    if (lower.includes('tidak ditemukan')) {
        return 'Target tidak ditemukan di dalam grup ini.';
    }
    if (lower.includes('creator') || lower.includes('owner')) {
        return 'Pembuat / Owner grup tidak dapat dikenakan tindakan ini.';
    }
    if (lower.includes('diri sendiri')) {
        return 'Bot tidak dapat menjalankan tindakan pada dirinya sendiri.';
    }
    if (lower.includes('timeout') || lower.includes('timed out')) {
        return 'Waktu permintaan habis saat menghubungi server WhatsApp.';
    }
    return detail.replace(/^Error:\s*/i, '').trim();
}

function summarizeActionResults(results) {
    if (!results || results.length === 0) return '';
    const lines = [];

    for (const r of results) {
        const actionName = (r.name || '').toUpperCase();
        if (r.status === 'SUCCESS') {
            lines.push(`✅ Berhasil: ${r.detail || actionName}`);
        } else if (r.status === 'FORBIDDEN') {
            lines.push(`⚠️ Tindakan ${actionName} tidak dapat dijalankan: ${formatFriendlyError(r.detail)}`);
        } else if (r.status === 'ERROR') {
            lines.push(`⚠️ Tindakan ${actionName} gagal diproses: ${formatFriendlyError(r.detail)}`);
        } else if (r.status === 'SKIPPED') {
            lines.push(`ℹ️ Tindakan ${actionName} dilewati: ${formatFriendlyError(r.detail)}`);
        } else if (r.status === 'CAPPED') {
            lines.push(`⚠️ Tindakan ${actionName} dilewati karena telah mencapai batas maksimal tindakan.`);
        }
    }

    return lines.length ? `\n\n${lines.join('\n')}` : '';
}

function extractMentions(text, contextJids = []) {
    const matches = text.match(/@\d+/g) || [];
    const nums = matches.map(m => m.substring(1));
    return nums.map(num => {
        const found = contextJids.find(j => j.startsWith(num + '@'));
        return found ? found : num + "@s.whatsapp.net";
    });
}

async function updateStatusMessage(sock, remoteJid, text, statusKeyRef, contextJids = []) {
    try {
        const mentions = extractMentions(text, contextJids);
        // Selalu kirim pesan baru sesuai instruksi (jangan diedit agar muncul terpisah per konteks)
        const sent = await sock.sendMessage(remoteJid, { text, mentions });
        return sent;
    } catch (sendErr) {
        console.error(`[LOG STATUS ERROR FATAL] Gagal mengirim pesan balasan baru:`, sendErr.message);
        return null;
    }
}

/**
 * Memformat status progress loop yang informatif untuk ditampilkan ke Owner.
 * Contoh: "[PROSES] Fase 1/2 | Langkah 2/5 | ✅ 3 aksi | ⚠️ 1 gagal"
 */
function formatLoopProgress(outerStep, maxOuter, innerStep, maxInner, stats) {
    const parts = [
        `Fase ${outerStep}/${maxOuter}`,
        `Langkah ${innerStep}/${maxInner}`
    ];
    if (stats.successCount > 0) parts.push(`✅ ${stats.successCount} aksi`);
    if (stats.failCount > 0) parts.push(`⚠️ ${stats.failCount} gagal`);
    if (stats.skipCount > 0) parts.push(`⏭️ ${stats.skipCount} dilewati`);
    return `[PROSES] ${parts.join(' | ')}`;
}

/**
 * Memformat ringkasan akhir loop untuk dikirim ke Owner.
 */
function formatLoopSummary(stats, cancelled = false) {
    const lines = [];
    if (cancelled) {
        lines.push('⛔ *Proses dibatalkan oleh Owner.*');
    } else {
        lines.push('✅ *PROSES SELESAI*');
    }
    lines.push('');
    lines.push('📊 *Statistik Eksekusi:*');
    lines.push(`- Total langkah dijalankan: ${stats.totalSteps}`);
    if (stats.successCount > 0) lines.push(`- Aksi berhasil: ${stats.successCount}`);
    if (stats.failCount > 0) lines.push(`- Aksi gagal: ${stats.failCount}`);
    if (stats.skipCount > 0) lines.push(`- Aksi dilewati: ${stats.skipCount}`);
    if (stats.retryCount > 0) lines.push(`- Total retry: ${stats.retryCount}`);
    return lines.join('\n');
}

module.exports = {
    extractMessageContent,
    cleanAiResponseForChat,
    summarizeActionResults,
    updateStatusMessage,
    formatLoopProgress,
    formatLoopSummary,
    extractMentions
};
