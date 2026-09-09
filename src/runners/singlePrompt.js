const { formatParticipantsList, formatMentionedTargets } = require('../utils/jid');
const { groupMessageHistory } = require('../utils/moderation');
const { generateWithRetry } = require('../ai/provider');
const { executeAiActions } = require('../actions');
const { cleanAiResponseForChat, summarizeActionResults } = require('../utils/messageHelper');

async function runSinglePromptWithRetry(sock, msg, promptText, isGroup, mentionedJidList, botInternalNumber, senderJid, quotedMessageKey, maxRetries = 3) {
    const remoteJid = msg.key.remoteJid;
    const destructiveCounter = { count: 0 };
    let attempt = 1;
    let lastActionErrors = "";

    console.log(`[LOG SINGLE PROMPT] Memproses prompt tunggal untuk ${remoteJid}`);

    while (attempt <= maxRetries) {
        const currentHistory = isGroup ? (groupMessageHistory[remoteJid] || []).join('\n') : "";
        let groupContext = "";
        if (isGroup) {
            try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const participantListStr = formatParticipantsList(groupMeta.participants);
                const taggedTargetsStr = formatMentionedTargets(mentionedJidList, botInternalNumber);
                groupContext = `\n[Info Grup]: Nama: ${groupMeta.subject} | Total Anggota: ${groupMeta.participants.length}\n[Daftar Anggota]:\n${participantListStr}\n[Target yang Di-Tag Owner di Pesan Ini]: ${taggedTargetsStr}\n[Nomor Pengirim Pesan Ini (Owner)]: ${senderJid.split('@')[0]} (JID: ${senderJid})\n`;
            } catch (metaErr) {
                console.error('[LOG ERROR] Gagal mengambil metadata grup:', metaErr.message);
            }
        }

        let errorFeedback = "";
        if (attempt > 1 && lastActionErrors) {
            errorFeedback = `\n[LAPORAN ERROR EKSEKUSI PERCOBAAN SEBELUMNYA]:\n${lastActionErrors}\n\nInstruksi Pengaman: Perbaiki target/parameter aksi berdasarkan [Daftar Anggota] atau tulis 'STATUS: LEWATI_AKSI'.`;
        }

        const fullPrompt = `${groupContext}${currentHistory ? `[Riwayat Diskusi Grup Sebelumnya]:\n${currentHistory}\n\n` : ""}[Instruksi Owner]: ${promptText}${errorFeedback}\n[Instruksi Sistem: Jika instruksi Owner meminta tindakan (seperti kick, promote, demote, add, dll), WAJIB langsung keluarkan blok perintah aksinya, misalnya [AKSI: KICK | nomor_target]. Ambil nomor/JID target dari [Target yang Di-Tag Owner di Pesan Ini] atau [Daftar Anggota]. JANGAN gunakan STATUS: LEWATI_AKSI kecuali target adalah Owner/Creator grup sendiri atau target tidak ada di grup. Sembunyikan penjelasan debug, alasan teknis internal, atau teks intro/outro dari chat balasan. Langsung berikan hasil akhir atau eksekusi aksi.]`;

        let aiResponse = null;
        try {
            console.log(`[LOG SINGLE PROMPT] Mengirim prompt ke AI (percobaan ${attempt}/${maxRetries})...`);
            aiResponse = await generateWithRetry(fullPrompt);
        } catch (error) {
            console.error(`[LOG ERROR] Gagal memanggil AI pada percobaan ${attempt}/${maxRetries}:`, error.message);
            if (attempt >= maxRetries) {
                await sock.sendMessage(remoteJid, { text: "Mohon maaf, sistem AI sedang mengalami gangguan atau mencapai batas antrean." }, { quoted: msg }).catch(() => {});
                return;
            }
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 1500));
            continue;
        }

        console.log(`[LOG SINGLE PROMPT] Raw AI Response:\n${aiResponse}`);

        if (aiResponse.includes("STATUS: LEWATI_AKSI")) {
            console.log(`[LOG SINGLE PROMPT] AI memutuskan melewati aksi (STATUS: LEWATI_AKSI).`);
            let cleaned = cleanAiResponseForChat(aiResponse);
            if (!cleaned || cleaned.trim().length === 0) {
                cleaned = "Mohon maaf, aksi tidak dapat dijalankan atau dilewati karena terdapat batasan hak akses atau target tidak memenuhi syarat.";
            }
            await sock.sendMessage(remoteJid, { text: cleaned }, { quoted: msg }).catch(() => {});
            return;
        }

        const actionResults = await executeAiActions(sock, remoteJid, aiResponse, destructiveCounter, { quotedMessageKey });
        const failedActions = actionResults.filter(r => r.status === 'FORBIDDEN' || r.status === 'ERROR');
        const cleanedReplyText = cleanAiResponseForChat(aiResponse) + summarizeActionResults(actionResults);

        if (failedActions.length > 0 && attempt < maxRetries) {
            console.log(`[LOG RETRY] Ditemukan aksi gagal pada single prompt. Mencoba ulang dengan error feedback...`);
            lastActionErrors = failedActions.map(r => `- Gagal eksekusi [AKSI: ${r.name}]: ${r.detail}`).join('\n');
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 1500));
            continue;
        }

        const successfulActions = actionResults.filter(r => r.status === 'SUCCESS');
        let replyToSend = cleanedReplyText.trim();
        if (!replyToSend && successfulActions.length > 0) {
            replyToSend = successfulActions.map(r => `✅ ${r.detail}`).join('\n');
        }

        if (replyToSend) {
            await sock.sendMessage(remoteJid, { text: replyToSend }, { quoted: msg }).catch(() => {});
            console.log(`[LOG SINGLE PROMPT] Balasan bersih berhasil dikirim ke chat.`);
        }
        return;
    }
}

module.exports = {
    runSinglePromptWithRetry
};
