const groupMessageHistory = {};

function checkMessageModeration(messageText, isOwner) {
    if (isOwner) return { safe: true };
    const textLower = messageText.toLowerCase();
    const hasLink = textLower.includes('http://') || textLower.includes('https://') || textLower.includes('chat.whatsapp.com/');
    if (hasLink) {
        console.log('[LOG MODERATION] Terdeteksi link/tautan dari member biasa. Menandai tidak aman.');
        return { safe: false, reason: 'Tautan/Link terdeteksi dan dilarang di grup ini.' };
    }
    return { safe: true };
}

function getGroupActivitySummary(remoteJid) {
    console.log(`[LOG ANALYTICS] Meringkas aktivitas percakapan untuk grup: ${remoteJid}`);
    const history = groupMessageHistory[remoteJid] || [];
    if (history.length === 0) return "Belum ada catatan aktivitas percakapan yang terekam di grup ini.";
    return `📊 *Ringkasan Aktivitas Grup*:\n- Total Pesan Tersimpan di Memori: ${history.length}\n\n[Cuplikan Diskusi Terakhir]:\n${history.slice(-10).join('\n')}`;
}

module.exports = {
    groupMessageHistory,
    checkMessageModeration,
    getGroupActivitySummary
};
