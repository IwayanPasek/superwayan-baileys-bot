const history = {};

function recordBotMessage(remoteJid, key) {
    if (!remoteJid || !key) return;
    if (!history[remoteJid]) {
        history[remoteJid] = [];
    }
    history[remoteJid].push(key);
    // Simpan maksimal 50 pesan terakhir per grup untuk mencegah kebocoran memori
    if (history[remoteJid].length > 50) {
        history[remoteJid].shift();
    }
}

function popRecentBotMessages(remoteJid, count = 1) {
    if (!history[remoteJid]) return [];
    const keys = [];
    for (let i = 0; i < count; i++) {
        const key = history[remoteJid].pop();
        if (key) {
            keys.push(key);
        } else {
            break; // Habis
        }
    }
    return keys;
}

module.exports = {
    recordBotMessage,
    popRecentBotMessages
};
