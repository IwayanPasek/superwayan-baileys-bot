const { formatParticipantsList, formatMentionedTargets } = require('../utils/jid');
const { groupMessageHistory } = require('../utils/moderation');
const { generateWithRetry } = require('../ai/provider');
const { executeAiActions } = require('../actions');
const { cleanAiResponseForChat, summarizeActionResults, extractMentions } = require('../utils/messageHelper');
const { buildSinglePrompt, buildErrorFeedback } = require('./promptBuilder');
const { LOOP_BASE_RETRY_DELAY_MS } = require('../config/env');

/**
 * Menghitung delay retry dengan exponential backoff + jitter.
 */
function getRetryDelay(attempt, baseDelay = LOOP_BASE_RETRY_DELAY_MS) {
    const exponential = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000;
    return Math.min(exponential + jitter, 30000);
}

async function runSinglePromptWithRetry(sock, msg, promptText, isGroup, mentionedJidList, botInternalNumber, senderJid, quotedMessageKey, maxRetries = 3) {
    const remoteJid = msg.key.remoteJid;
    const destructiveCounter = { count: 0 };
    let lastActionErrors = "";

    console.log(`[LOG SINGLE PROMPT] Memproses prompt tunggal untuk ${remoteJid}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // ── Bangun konteks grup ──
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

        // ── Bangun prompt menggunakan prompt builder ──
        const fullPrompt = buildSinglePrompt({
            promptText,
            groupContext,
            chatHistory: currentHistory,
            errorFeedback: buildErrorFeedback(lastActionErrors)
        });

        // ── AI Call ──
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
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, getRetryDelay(attempt)));
            continue;
        }

        // ── Cek LEWATI_AKSI ──
        if (aiResponse.includes("STATUS: LEWATI_AKSI")) {
            console.log(`[LOG SINGLE PROMPT] AI memutuskan melewati aksi (STATUS: LEWATI_AKSI).`);
            let cleaned = cleanAiResponseForChat(aiResponse);
            if (!cleaned || cleaned.trim().length === 0) {
                cleaned = "Mohon maaf, aksi tidak dapat dijalankan atau dilewati karena terdapat batasan hak akses atau target tidak memenuhi syarat.";
            }
            const mentions = extractMentions(cleaned);
            await sock.sendMessage(remoteJid, { text: cleaned, mentions }, { quoted: msg }).catch(() => {});
            return;
        }

        // ── Execute Actions ──
        const actionResults = await executeAiActions(sock, remoteJid, aiResponse, destructiveCounter, { quotedMessageKey });
        const failedActions = actionResults.filter(r => r.status === 'FORBIDDEN' || r.status === 'ERROR');
        const cleanedReplyText = cleanAiResponseForChat(aiResponse) + summarizeActionResults(actionResults);

        // ── Retry jika ada aksi gagal ──
        if (failedActions.length > 0 && attempt < maxRetries) {
            console.log(`[LOG RETRY] Ditemukan aksi gagal pada single prompt. Mencoba ulang dengan error feedback...`);
            lastActionErrors = failedActions.map(r => `- Gagal eksekusi [AKSI: ${r.name}]: ${r.detail}`).join('\n');
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, getRetryDelay(attempt)));
            continue;
        }

        // ── Kirim balasan / Feedback ──
        let textToSend = cleanedReplyText.trim();
        if (!textToSend) {
            if (actionResults.length > 0) {
                textToSend = summarizeActionResults(actionResults).trim();
            }
            if (!textToSend) {
                textToSend = "Permintaan telah diproses oleh asisten.";
            }
        }

        const mentions = extractMentions(textToSend);
        await sock.sendMessage(remoteJid, { text: textToSend, mentions }, { quoted: msg }).catch(() => {});
        console.log(`[LOG SINGLE PROMPT] Balasan/feedback berhasil dikirim ke chat.`);
        return;
    }

    // ── Jika seluruh attempt habis dan loop berakhir tanpa return ──
    await sock.sendMessage(remoteJid, { 
        text: "⚠️ Maaf, permintaan tidak dapat diselesaikan setelah beberapa kali percobaan. Silakan periksa kembali target atau izin admin grup." 
    }, { quoted: msg }).catch(() => {});
}

module.exports = {
    runSinglePromptWithRetry
};
