const { BOT_NUMBER, BOT_LID } = require('../config/env');

function toJid(raw) {
    let t = (raw || '').trim();
    if (!t) return null;
    // Bersihkan prefix '@' jika target berupa tag/mention WhatsApp (mis. @628123456789)
    if (t.startsWith('@')) {
        t = t.substring(1).trim();
    }
    // Jika sudah memiliki domain WhatsApp yang sah
    if (t.endsWith('@s.whatsapp.net') || t.endsWith('@lid') || t.endsWith('@g.us') || t.endsWith('@c.us')) {
        return t;
    }
    const digitsOnly = t.replace(/[^0-9]/g, '');
    if (digitsOnly.length < 8) return null;
    return digitsOnly + '@s.whatsapp.net';
}

function parseTargetJids(raw) {
    if (!raw) return [];
    // Mendukung pemisah koma, titik koma, spasi, baris baru, atau simbol pemisah umum
    const parts = raw.split(/[\s,;|]+/).filter(Boolean);
    const result = [];
    for (const part of parts) {
        const jid = toJid(part);
        if (jid && !result.includes(jid)) {
            result.push(jid);
        }
    }
    return result;
}

function formatParticipantsList(participants, limit = 100) {
    if (!participants || participants.length === 0) return '(tidak ada data anggota)';
    const sliced = participants.slice(0, limit);
    const lines = sliced.map(p => {
        const number = (p.id || '').split('@')[0];
        const name = p.notify || p.name || '-';
        const role = p.admin === 'superadmin' ? 'Owner/SuperAdmin' : (p.admin === 'admin' ? 'Admin' : 'Member');
        return `- ${name} (${number}) [${role}] JID:${p.id}`;
    });
    const extra = participants.length > limit ? `\n... dan ${participants.length - limit} anggota lain` : '';
    return lines.join('\n') + extra;
}

function formatMentionedTargets(mentionedJidList, botInternalNumber) {
    if (!mentionedJidList || mentionedJidList.length === 0) return '(tidak ada target yang di-tag pada pesan ini)';
    const cleanBot = (BOT_NUMBER || '').replace(/[^0-9]/g, '');
    const cleanLid = (BOT_LID || '').replace(/[^0-9]/g, '');
    const filtered = mentionedJidList.filter(jid => {
        const num = jid.split('@')[0];
        return num !== botInternalNumber && (!cleanBot || num !== cleanBot) && (!cleanLid || num !== cleanLid);
    });
    if (filtered.length === 0) return '(tidak ada target yang di-tag pada pesan ini)';
    return filtered.map((jid, idx) => `${idx + 1}. ${jid.split('@')[0]} (JID: ${jid})`).join(', ');
}

module.exports = {
    toJid,
    parseTargetJids,
    formatParticipantsList,
    formatMentionedTargets
};
