const { formatParticipantsList, formatMentionedTargets } = require('../utils/jid');

/**
 * Membangun string konteks metadata grup untuk dimasukkan ke prompt AI.
 */
function buildGroupMetaContext(groupMetadataInfo, msgContext, botInternalNumber) {
    const participantListStr = formatParticipantsList(groupMetadataInfo.participants);
    const taggedTargetsStr = formatMentionedTargets(msgContext && msgContext.mentionedJid, botInternalNumber);
    return `\n\n[Metadata Grup]:\nNama: ${groupMetadataInfo.subject}\nDeskripsi: ${groupMetadataInfo.desc}\nTotal Anggota: ${groupMetadataInfo.participants.length}\n[Daftar Anggota]:\n${participantListStr}\n[Target yang Di-Tag Owner]: ${taggedTargetsStr}`;
}

/**
 * Membangun string riwayat chat untuk dimasukkan ke prompt AI.
 */
function buildChatHistoryContext(chatHistory) {
    if (!chatHistory || chatHistory.length === 0) return "";
    return `\n\n[Riwayat Pesan Terbaca di Grup]:\n${chatHistory.join('\n')}`;
}

/**
 * Membangun feedback error dari percobaan sebelumnya.
 */
function buildErrorFeedback(lastActionErrors) {
    if (!lastActionErrors) return "";
    return `\n[LAPORAN ERROR HAK AKSES/SISTEM]:\nAksi sebelumnya GAGAL:\n${lastActionErrors}\n\nInstruksi Pengaman: Jangan mengulang perintah pelanggaran hierarki. Ubah strategi atau ketik 'STATUS: LEWATI_AKSI'.`;
}

/**
 * Memotong dan meringkas execution log agar tidak membengkak.
 * Menjaga hanya N entri terakhir + ringkasan jumlah entri terpotong.
 */
function truncateExecutionLog(logEntries, maxEntries = 20) {
    if (logEntries.length <= maxEntries) {
        return logEntries.map(e => e.text).join('\n');
    }
    const trimmed = logEntries.length - maxEntries;
    const summary = `\n[... ${trimmed} langkah sebelumnya diringkas ...]`;
    const recentEntries = logEntries.slice(-maxEntries).map(e => e.text).join('\n');
    return summary + '\n' + recentEntries;
}

/**
 * Membangun prompt untuk satu iterasi di Fase Mulai (autonomous loop).
 */
function buildIterationPrompt({ initialPrompt, outerStep, innerStep, attempt, executionLog, maxLogEntries, errorFeedback, groupMetaContext, chatHistoryContext }) {
    const logText = truncateExecutionLog(executionLog, maxLogEntries);
    return [
        `[FASE MULAI - Iterasi Luar ${outerStep}, Iterasi Dalam ${innerStep}, Percobaan ${attempt}]`,
        `Instruksi Utama: ${initialPrompt}`,
        `Akumulasi Aksi Sebelumnya: ${logText}`,
        errorFeedback,
        groupMetaContext,
        chatHistoryContext,
        '',
        `[Instruksi Sistem: Jalankan langkah aksi iteratif ini. Sembunyikan pesan debug atau alasan teknis internal. Jika perlu eksekusi fitur WhatsApp, gunakan format [AKSI: NAMA_AKSI | parameter]. Jika sub-tugas iterasi ini selesai, tuliskan 'STATUS: LANJUT_FASE_BERIKUTNYA' di akhir balasan.]`
    ].filter(s => s !== undefined).join('\n');
}

/**
 * Membangun prompt untuk Fase Selesai (jawaban akhir).
 */
function buildFinalPrompt({ initialPrompt, executionLog, maxLogEntries, errorFeedback }) {
    const logText = truncateExecutionLog(executionLog, maxLogEntries);
    return [
        `[FASE SELESAI - JAWABAN AKHIR]`,
        `Instruksi Awal: ${initialPrompt}`,
        `Seluruh Log/Aksi yang Telah Dijalankan:\n${logText}`,
        errorFeedback,
        '',
        `[Instruksi Sistem: Berikan ringkasan laporan akhir dan jawaban akhir yang komprehensif kepada Owner. Sembunyikan seluruh teks debug, alasan teknis internal, atau kalimat pemikiran analitis.]`
    ].filter(s => s !== undefined).join('\n');
}

/**
 * Membangun prompt untuk single prompt runner (non-loop).
 */
function buildSinglePrompt({ promptText, groupContext, chatHistory, errorFeedback }) {
    return [
        groupContext,
        chatHistory ? `[Riwayat Diskusi Grup Sebelumnya]:\n${chatHistory}\n` : '',
        `[Instruksi Owner]: ${promptText}`,
        errorFeedback,
        `[Instruksi Sistem: Jika Owner meminta tindakan seperti kick, promote, demote, add, setname, open/close grup, dsb, WAJIB langsung keluarkan blok perintah aksinya, misalnya [AKSI: KICK | nomor_target]. Ambil nomor atau JID dari [Target yang Di-Tag Owner] atau [Daftar Anggota]. JANGAN gunakan STATUS: LEWATI_AKSI kecuali target adalah Creator/Owner grup itu sendiri atau target tidak ada di grup. Sembunyikan penjelasan debug, alasan teknis internal, atau teks intro/outro dari chat balasan. Langsung berikan hasil akhir atau eksekusi aksi.]`
    ].filter(Boolean).join('\n');
}

module.exports = {
    buildGroupMetaContext,
    buildChatHistoryContext,
    buildErrorFeedback,
    truncateExecutionLog,
    buildIterationPrompt,
    buildFinalPrompt,
    buildSinglePrompt
};
