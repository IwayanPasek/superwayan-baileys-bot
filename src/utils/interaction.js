async function simulateActivity(sock, remoteJid, msgKey) {
    try {
        console.log(`[LOG ACTIVITY] Menandai pesan dibaca (read) & kirim status mengetik (typing) ke: ${remoteJid}`);
        await sock.readMessages([msgKey]);
        await sock.sendPresenceUpdate('composing', remoteJid);
    } catch (e) {
        console.error('[LOG ACTIVITY ERROR] Gagal simulate activity:', e.message);
    }
}

async function sendReaction(sock, remoteJid, msgKey, emoji) {
    try {
        console.log(`[LOG REACTION] Mengirim reaksi emoji "${emoji}" ke pesan di grup: ${remoteJid}`);
        await sock.sendMessage(remoteJid, { react: { text: emoji, key: msgKey } });
    } catch (e) {
        console.error('[LOG REACTION ERROR] Gagal kirim reaksi:', e.message);
    }
}

async function sendGroupPoll(sock, remoteJid, pollTitle, optionsArray) {
    try {
        console.log(`[LOG POLL] Membuat poling baru di ${remoteJid} dengan judul: "${pollTitle}"`);
        await sock.sendMessage(remoteJid, {
            poll: { name: pollTitle, values: optionsArray, selectableCount: 1 }
        });
    } catch (e) {
        console.error('[LOG POLL ERROR] Gagal buat poling:', e.message);
    }
}

function scheduleTask(sock, targetJid, messageText, delayMinutes) {
    const delayMs = delayMinutes * 60 * 1000;
    console.log(`[LOG SCHEDULE] Menjadwalkan tugas baru untuk dikirim ke ${targetJid} dalam ${delayMinutes} menit.`);
    setTimeout(async () => {
        try {
            console.log(`[LOG SCHEDULE] Mengeksekusi pengingat terjadwal untuk ${targetJid}...`);
            await sock.sendMessage(targetJid, { text: `⏰ *[PENGINGAT TERJADWAL]*:\n\n${messageText}` });
            console.log('[LOG SCHEDULE] Pengingat terjadwal berhasil dikirim.');
        } catch (e) {
            console.error('[LOG SCHEDULE ERROR] Gagal kirim tugas terjadwal:', e.message);
        }
    }, delayMs);
}

module.exports = {
    simulateActivity,
    sendReaction,
    sendGroupPoll,
    scheduleTask
};
