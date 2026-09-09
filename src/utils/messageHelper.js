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
        quotedMessageKey = {
            remoteJid: msg.key.remoteJid,
            id: contextInfo.stanzaId,
            participant: quotedParticipant,
            fromMe: botInternalNumber ? quotedParticipant.split('@')[0] === botInternalNumber : false
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

function summarizeActionResults(results) {
    const problems = results.filter(r => ['FORBIDDEN', 'ERROR', 'SKIPPED', 'CAPPED'].includes(r.status));
    if (problems.length === 0) return '';
    const lines = problems.map(r => {
        if (r.status === 'FORBIDDEN') return `⚠️ ${r.name}: ditolak (${r.detail})`;
        if (r.status === 'ERROR') return `⚠️ ${r.name}: gagal (${r.detail})`;
        if (r.status === 'SKIPPED') return `ℹ️ ${r.name}: dilewati (${r.detail})`;
        if (r.status === 'CAPPED') return `⚠️ ${r.name}: dilewati, mencapai batas aksi`;
        return null;
    }).filter(Boolean);
    return lines.length ? `\n\n${lines.join('\n')}` : '';
}

async function updateStatusMessage(sock, remoteJid, text, statusKeyRef) {
    try {
        console.log(`[LOG STATUS MSG] Mencoba mengedit pesan status di ${remoteJid}`);
        const sent = await sock.sendMessage(remoteJid, { text, edit: statusKeyRef.key });
        return sent;
    } catch (editErr) {
        console.log(`[LOG STATUS MSG] Edit pesan gagal (${editErr.message}), mengirim pesan baru sebagai gantinya...`);
        try {
            const sent = await sock.sendMessage(remoteJid, { text });
            statusKeyRef.key = sent.key;
            return sent;
        } catch (sendErr) {
            console.error(`[LOG STATUS ERROR FATAL] Gagal mengirim pesan status baru:`, sendErr.message);
            return null;
        }
    }
}

module.exports = {
    extractMessageContent,
    cleanAiResponseForChat,
    summarizeActionResults,
    updateStatusMessage
};
