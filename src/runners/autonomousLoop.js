const { formatParticipantsList, formatMentionedTargets } = require('../utils/jid');
const { generateWithRetry } = require('../ai/provider');
const { executeAiActions } = require('../actions');
const { cleanAiResponseForChat, summarizeActionResults, updateStatusMessage } = require('../utils/messageHelper');

const activeLoops = new Map();

async function runNestedAutonomousLoop(sock, remoteJid, initialPrompt, chatHistory, groupMetadataInfo, msgContext, botInternalNumber, maxOuterSteps = 3, maxInnerSteps = 3) {
    if (activeLoops.has(remoteJid)) {
        console.log(`[LOG LOOP] Proses loop otonom diabaikan karena sudah ada yang aktif di grup: ${remoteJid}`);
        await sock.sendMessage(remoteJid, { text: '[SYSTEM] Masih ada proses berjalan di grup ini. Ketik "stop" dulu untuk membatalkannya sebelum memulai proses baru.' });
        return;
    }
    const loopState = { cancel: false };
    activeLoops.set(remoteJid, loopState);
    const destructiveCounter = { count: 0 };
    console.log(`[LOG LOOP START] Memulai Autonomous Loop untuk grup ${remoteJid}`);

    try {
        let outerStep = 1;
        const statusMsg = await sock.sendMessage(remoteJid, { text: `[SYSTEM] Memulai Proses Mulai (Fase Iteratif Luar ${outerStep}/${maxOuterSteps})...\n(Ketik "stop" kapan saja untuk membatalkan)` });
        const statusKeyRef = { key: statusMsg.key };

        let accumulatedExecutionLog = "";

        outerLoop:
        while (outerStep <= maxOuterSteps) {
            let innerStep = 1;
            let isPhaseStartDone = false;

            while (innerStep <= maxInnerSteps) {
                if (loopState.cancel) {
                    console.log(`[LOG LOOP] Perintah pembatalan terdeteksi di inner loop.`);
                    break outerLoop;
                }

                let attempt = 1;
                const maxRetries = 2;
                let stepSuccess = false;
                let lastActionErrors = ""; 

                while (attempt <= maxRetries && !stepSuccess) {
                    if (loopState.cancel) break;

                    let aiResponse = null;
                    try {
                        console.log(`[LOG LOOP] Iterasi Luar ${outerStep}, Dalam ${innerStep} (Percobaan ${attempt}/${maxRetries})`);
                        const contextData = chatHistory.length > 0 ? `\n\n[Riwayat Pesan Terbaca di Grup]:\n${chatHistory.join('\n')}` : "";
                        const participantListStr = formatParticipantsList(groupMetadataInfo.participants);
                        const taggedTargetsStr = formatMentionedTargets(msgContext && msgContext.mentionedJid, botInternalNumber);
                        const metaDataStr = `\n\n[Metadata Grup]:\nNama: ${groupMetadataInfo.subject}\nDeskripsi: ${groupMetadataInfo.desc}\nTotal Anggota: ${groupMetadataInfo.participants.length}\n[Daftar Anggota]:\n${participantListStr}\n[Target yang Di-Tag Owner]: ${taggedTargetsStr}`;

                        let errorContextFeedback = "";
                        if (attempt > 1 && lastActionErrors !== "") {
                            errorContextFeedback = `\n[LAPORAN ERROR HAK AKSES/SISTEM]:\nAksi sebelumnya GAGAL:\n${lastActionErrors}\n\nInstruksi Pengaman: Jangan mengulang perintah pelanggaran hierarki. Ubah strategi atau ketik 'STATUS: LEWATI_AKSI'.`;
                        }

                        const promptToSend = `[FASE MULAI - Iterasi Luar ${outerStep}, Iterasi Dalam ${innerStep}, Percobaan ${attempt}]\nInstruksi Utama: ${initialPrompt}\nAkumulasi Aksi Sebelumnya: ${accumulatedExecutionLog}${errorContextFeedback}${metaDataStr}${contextData}\n\n[Instruksi Sistem: Jalankan langkah aksi iteratif ini. Sembunyikan pesan debug atau alasan teknis internal. Jika perlu eksekusi fitur WhatsApp, gunakan format [AKSI: NAMA_AKSI | parameter]. Jika sub-tugas iterasi ini selesai, tuliskan 'STATUS: LANJUT_FASE_BERIKUTNYA' di akhir balasan.]`;

                        aiResponse = await generateWithRetry(promptToSend);
                    } catch (aiErr) {
                        console.error(`[LOG LOOP ERROR] Gagal di AI Call (${outerStep}.${innerStep}, percobaan ${attempt}):`, aiErr.message);
                        if (aiErr.message === "AI_MAX_LIMIT_REACHED" || attempt >= maxRetries) {
                            accumulatedExecutionLog += `\n- Langkah ${outerStep}.${innerStep} (AI gagal/limit): dilewati`;
                            stepSuccess = true;
                            break;
                        }
                        attempt++;
                        continue;
                    }

                    if (aiResponse.includes("STATUS: LEWATI_AKSI")) {
                        console.log(`[LOG LOOP] AI memutuskan untuk melewati aksi (STATUS: LEWATI_AKSI)`);
                        accumulatedExecutionLog += `\n- Langkah ${outerStep}.${innerStep} (Dilewati atas keputusan AI): ${aiResponse}`;
                        stepSuccess = true;
                        break;
                    }

                    const actionResults = await executeAiActions(sock, remoteJid, aiResponse, destructiveCounter, msgContext);
                    const failedActions = actionResults.filter(r => r.status === 'FORBIDDEN' || r.status === 'ERROR');

                    if (failedActions.length > 0 && attempt < maxRetries) {
                        console.log(`[LOG LOOP] Ditemukan aksi gagal. Menyiapkan retry dengan error feedback...`);
                        lastActionErrors = failedActions.map(r => `- Gagal eksekusi [AKSI: ${r.name}]: ${r.detail}`).join('\n');
                        attempt++;
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }

                    accumulatedExecutionLog += `\n- Langkah ${outerStep}.${innerStep}: ${aiResponse}`;
                    stepSuccess = true;

                    const cleanedResponse = cleanAiResponseForChat(aiResponse) + summarizeActionResults(actionResults);
                    if (cleanedResponse.trim().length > 0) {
                        await updateStatusMessage(sock, remoteJid, `[PROSES MULAI (${outerStep}.${innerStep})]\n${cleanedResponse}`, statusKeyRef);
                    }

                    if (aiResponse.includes("STATUS: LANJUT_FASE_BERIKUTNYA") || aiResponse.includes("[AKSI: LEAVE_GROUP]") || innerStep >= maxInnerSteps) {
                        console.log(`[LOG LOOP] Fase Mulai selesai pada (${outerStep}.${innerStep})`);
                        isPhaseStartDone = true;
                        break;
                    }
                }

                if (isPhaseStartDone || loopState.cancel) break;
                innerStep++;
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            if (isPhaseStartDone || loopState.cancel || outerStep >= maxOuterSteps) {
                break;
            }
            outerStep++;
        }

        if (loopState.cancel) {
            console.log(`[LOG LOOP] Proses dihentikan/dibatalkan oleh Owner.`);
            await updateStatusMessage(sock, remoteJid, `[SYSTEM] ⛔ Proses dibatalkan oleh Owner.\n\nLog aksi sejauh ini:${accumulatedExecutionLog || ' (belum ada)'}`, statusKeyRef);
            return;
        }

        console.log(`[LOG LOOP] Memasuki FASE SELESAI (Jawaban Akhir)...`);
        await updateStatusMessage(sock, remoteJid, `[SYSTEM] Proses Mulai selesai. Melanjutkan ke Fase Selesai untuk memberikan jawaban akhir...`, statusKeyRef);

        let finalAttempt = 1;
        let finalSuccess = false;
        let lastFinalErrors = "";

        while (finalAttempt <= 2 && !finalSuccess) {
            try {
                let finalErrorContext = "";
                if (finalAttempt > 1 && lastFinalErrors !== "") {
                    finalErrorContext = `\n[PERINGATAN HAK AKSES]:\n${lastFinalErrors}\nUbah taktik atau tulis 'STATUS: LEWATI_AKSI'.`;
                }

                const finalPromptToSend = `[FASE SELESAI - JAWABAN AKHIR]\nInstruksi Awal: ${initialPrompt}\nSeluruh Log/Aksi yang Telah Dijalankan:\n${accumulatedExecutionLog}${finalErrorContext}\n\n[Instruksi Sistem: Berikan ringkasan laporan akhir dan jawaban akhir yang komprehensif kepada Owner. Sembunyikan seluruh teks debug, alasan teknis internal, atau kalimat pemikiran analitis.]`;

                const finalResponse = await generateWithRetry(finalPromptToSend);
                console.log(`[LOG LOOP] Respons final diterima pada percobaan ${finalAttempt}`);

                if (finalResponse.includes("STATUS: LEWATI_AKSI")) {
                    finalSuccess = true;
                    await updateStatusMessage(sock, remoteJid, `✅ *PROSES SELESAI & JAWABAN AKHIR*:\n\nProses diselesaikan dengan menyesuaikan batasan hak akses sistem grup.`, statusKeyRef);
                    break;
                }

                const finalActionResults = await executeAiActions(sock, remoteJid, finalResponse, destructiveCounter, msgContext);
                const finalFailedActions = finalActionResults.filter(r => r.status === 'FORBIDDEN' || r.status === 'ERROR');

                if (finalFailedActions.length > 0 && finalAttempt < 2) {
                    lastFinalErrors = finalFailedActions.map(r => `- Gagal eksekusi [AKSI: ${r.name}]: ${r.detail}`).join('\n');
                    finalAttempt++;
                    continue;
                }

                finalSuccess = true;
                const finalCleanedResponse = cleanAiResponseForChat(finalResponse) + summarizeActionResults(finalActionResults);

                if (finalCleanedResponse.trim()) {
                    await updateStatusMessage(sock, remoteJid, `✅ *PROSES SELESAI & JAWABAN AKHIR*:\n\n${finalCleanedResponse}`, statusKeyRef);
                }
                console.log(`[LOG LOOP] Proses Selesai sukses dikirim ke chat.`);
            } catch (err) {
                console.error(`[LOG LOOP ERROR] Gagal pada final phase percobaan ${finalAttempt}:`, err.message);
                if (finalAttempt >= 2) {
                    await updateStatusMessage(sock, remoteJid, "[ERROR] Gagal merampungkan fase selesai.", statusKeyRef);
                }
                finalAttempt++;
            }
        }
    } finally {
        console.log(`[LOG LOOP END] Melepaskan kunci activeLoops untuk grup: ${remoteJid}`);
        activeLoops.delete(remoteJid);
    }
}

module.exports = {
    activeLoops,
    runNestedAutonomousLoop
};
