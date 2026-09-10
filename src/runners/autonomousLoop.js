const { generateWithRetry } = require('../ai/provider');
const { executeAiActions } = require('../actions');
const { cleanAiResponseForChat, summarizeActionResults, updateStatusMessage, formatLoopProgress, formatLoopSummary } = require('../utils/messageHelper');
const { buildGroupMetaContext, buildChatHistoryContext, buildErrorFeedback, buildIterationPrompt, buildFinalPrompt } = require('./promptBuilder');
const log = require('../utils/logger');
const {
    LOOP_MAX_OUTER_STEPS,
    LOOP_MAX_INNER_STEPS,
    LOOP_STEP_TIMEOUT_MS,
    LOOP_BASE_RETRY_DELAY_MS,
    LOOP_MAX_LOG_ENTRIES
} = require('../config/env');

// ─── Registry Loop Aktif ────────────────────────────────────────────────────
const activeLoops = new Map();

// ─── Custom Error untuk Cancel ──────────────────────────────────────────────
class LoopCancelledError extends Error {
    constructor() { super('LOOP_CANCELLED'); this.name = 'LoopCancelledError'; }
}

function getContextJids(ctx) {
    const fromMeta = ctx.groupMetadataInfo?.participants?.map(p => p.id) || [];
    const fromMsg = ctx.msgContext?.mentionedJid || [];
    return [...fromMeta, ...fromMsg];
}

// ─── Utility ────────────────────────────────────────────────────────────────

/**
 * Menghitung delay retry dengan exponential backoff + jitter.
 * Cap maksimum 30 detik agar tidak terlalu lama.
 */
function getRetryDelay(attempt, baseDelay = LOOP_BASE_RETRY_DELAY_MS) {
    const exponential = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000;
    return Math.min(exponential + jitter, 30000);
}

/**
 * Cek apakah loop sudah diminta cancel, jika ya lempar error.
 */
function checkCancelled(loopState) {
    if (loopState.cancel) throw new LoopCancelledError();
}

/**
 * Membungkus promise dengan timeout. Jika timeout terlewati, reject.
 */
function withTimeout(promise, timeoutMs, label = 'operation') {
    const timer = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`STEP_TIMEOUT: ${label} melebihi ${timeoutMs}ms`)), timeoutMs)
    );
    return Promise.race([promise, timer]);
}

/**
 * Delay helper yang juga mengecek cancel state.
 */
async function cancellableDelay(ms, loopState) {
    await new Promise(resolve => setTimeout(resolve, ms));
    checkCancelled(loopState);
}

// ─── Context Object ─────────────────────────────────────────────────────────

/**
 * Membuat context object yang menyimpan seluruh state loop.
 */
function createLoopContext(sock, remoteJid, initialPrompt, chatHistory, groupMetadataInfo, msgContext, botInternalNumber, maxOuterSteps, maxInnerSteps) {
    return {
        sock,
        remoteJid,
        initialPrompt,
        chatHistory,
        groupMetadataInfo,
        msgContext,
        botInternalNumber,
        maxOuterSteps,
        maxInnerSteps,
        loopState: { cancel: false },
        destructiveCounter: { count: 0 },
        executionLog: [],          // Array of { step, text }
        stats: {
            totalSteps: 0,
            successCount: 0,
            failCount: 0,
            skipCount: 0,
            retryCount: 0
        },
        statusKeyRef: null,        // Akan diisi setelah pesan status pertama terkirim
        // Pre-build context strings (tidak berubah sepanjang loop)
        groupMetaContext: buildGroupMetaContext(groupMetadataInfo, msgContext, botInternalNumber),
        chatHistoryContext: buildChatHistoryContext(chatHistory)
    };
}

// ─── Fungsi Inti: Satu Langkah ──────────────────────────────────────────────

/**
 * Menjalankan satu langkah AI call + action execution dengan retry.
 * 
 * Return:
 *   { done: boolean, aiResponse: string|null }
 *   - done=true: fase ini selesai (AI menulis LANJUT_FASE_BERIKUTNYA / LEAVE_GROUP / skip)
 */
async function runSingleStep(ctx, outerStep, innerStep) {
    const maxRetries = 2;
    let lastActionErrors = "";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        checkCancelled(ctx.loopState);

        const stepLabel = `${outerStep}.${innerStep}`;
        console.log(`[LOG LOOP] Iterasi ${stepLabel} (Percobaan ${attempt}/${maxRetries})`);

        // ── AI Call ──
        let aiResponse = null;
        try {
            const prompt = buildIterationPrompt({
                initialPrompt: ctx.initialPrompt,
                outerStep,
                innerStep,
                attempt,
                executionLog: ctx.executionLog,
                maxLogEntries: LOOP_MAX_LOG_ENTRIES,
                errorFeedback: buildErrorFeedback(lastActionErrors),
                groupMetaContext: ctx.groupMetaContext,
                chatHistoryContext: ctx.chatHistoryContext
            });

            aiResponse = await withTimeout(
                generateWithRetry(prompt),
                LOOP_STEP_TIMEOUT_MS,
                `AI call langkah ${stepLabel}`
            );
        } catch (aiErr) {
            if (aiErr instanceof LoopCancelledError) throw aiErr;

            console.error(`[LOG LOOP ERROR] Gagal AI Call (${stepLabel}, percobaan ${attempt}):`, aiErr.message);
            ctx.stats.retryCount++;

            if (aiErr.message === "AI_MAX_LIMIT_REACHED" || attempt >= maxRetries) {
                ctx.executionLog.push({ step: stepLabel, text: `- Langkah ${stepLabel} (AI gagal/limit): dilewati` });
                ctx.stats.skipCount++;
                ctx.stats.totalSteps++;
                return { done: false, aiResponse: null };
            }

            await cancellableDelay(getRetryDelay(attempt), ctx.loopState);
            continue;
        }

        // ── Cek LEWATI_AKSI ──
        if (aiResponse.includes("STATUS: LEWATI_AKSI")) {
            console.log(`[LOG LOOP] AI memutuskan melewati aksi (STATUS: LEWATI_AKSI)`);
            ctx.executionLog.push({ step: stepLabel, text: `- Langkah ${stepLabel} (Dilewati atas keputusan AI): ${aiResponse}` });
            ctx.stats.skipCount++;
            ctx.stats.totalSteps++;
            return { done: false, aiResponse };
        }

        // ── Execute Actions ──
        checkCancelled(ctx.loopState);
        const actionResults = await executeAiActions(ctx.sock, ctx.remoteJid, aiResponse, ctx.destructiveCounter, ctx.msgContext);
        const failedActions = actionResults.filter(r => r.status === 'FORBIDDEN' || r.status === 'ERROR');

        // ── Retry jika ada aksi gagal ──
        if (failedActions.length > 0 && attempt < maxRetries) {
            console.log(`[LOG LOOP] Aksi gagal ditemukan, menyiapkan retry...`);
            lastActionErrors = failedActions.map(r => `- Gagal eksekusi [AKSI: ${r.name}]: ${r.detail}`).join('\n');
            ctx.stats.retryCount++;
            ctx.stats.failCount += failedActions.length;
            await cancellableDelay(getRetryDelay(attempt), ctx.loopState);
            continue;
        }

        // ── Catat hasil ──
        ctx.executionLog.push({ step: stepLabel, text: `- Langkah ${stepLabel}: ${aiResponse}` });
        ctx.stats.totalSteps++;

        const successActions = actionResults.filter(r => r.status === 'SUCCESS');
        ctx.stats.successCount += successActions.length;
        ctx.stats.failCount += failedActions.length;

        // ── Update status message ──
        const cleanedResponse = cleanAiResponseForChat(aiResponse) + summarizeActionResults(actionResults);
        if (cleanedResponse.trim().length > 0) {
            const progressHeader = formatLoopProgress(outerStep, ctx.maxOuterSteps, innerStep, ctx.maxInnerSteps, ctx.stats);
            await updateStatusMessage(ctx.sock, ctx.remoteJid, `${progressHeader}\n\n${cleanedResponse}`, ctx.statusKeyRef, getContextJids(ctx));
        }

        // ── Cek apakah fase selesai ──
        const isDone = aiResponse.includes("STATUS: LANJUT_FASE_BERIKUTNYA") || aiResponse.includes("[AKSI: LEAVE_GROUP]");
        if (isDone) {
            console.log(`[LOG LOOP] Fase Mulai selesai pada (${stepLabel})`);
        }
        return { done: isDone, aiResponse };
    }

    // Semua retry habis tanpa return — langkah ini dianggap selesai
    ctx.stats.totalSteps++;
    return { done: false, aiResponse: null };
}

// ─── Fungsi Inti: Inner Phase ───────────────────────────────────────────────

/**
 * Menjalankan satu fase inner loop (serangkaian langkah dalam satu outer step).
 * Return true jika fase selesai (AI request lanjut ke fase berikutnya).
 */
async function runInnerPhase(ctx, outerStep) {
    for (let innerStep = 1; innerStep <= ctx.maxInnerSteps; innerStep++) {
        checkCancelled(ctx.loopState);

        const { done } = await runSingleStep(ctx, outerStep, innerStep);
        if (done) return true;

        // Delay antar langkah (kecuali langkah terakhir)
        if (innerStep < ctx.maxInnerSteps) {
            await cancellableDelay(getRetryDelay(1, 2000), ctx.loopState);
        }
    }
    // Semua inner step habis, anggap fase selesai
    return true;
}

// ─── Fungsi Inti: Final Phase ───────────────────────────────────────────────

/**
 * Menjalankan Fase Selesai — meminta AI memberikan jawaban akhir.
 * Menggunakan retry logic yang sama dengan step biasa (tanpa duplikasi).
 */
async function runFinalPhase(ctx) {
    const maxRetries = 2;
    let lastFinalErrors = "";

    console.log(`[LOG LOOP] Memasuki FASE SELESAI (Jawaban Akhir)...`);
    await updateStatusMessage(ctx.sock, ctx.remoteJid, `[SYSTEM] Proses Mulai selesai. Melanjutkan ke Fase Selesai untuk memberikan jawaban akhir...`, ctx.statusKeyRef, getContextJids(ctx));

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        checkCancelled(ctx.loopState);

        try {
            const prompt = buildFinalPrompt({
                initialPrompt: ctx.initialPrompt,
                executionLog: ctx.executionLog,
                maxLogEntries: LOOP_MAX_LOG_ENTRIES,
                errorFeedback: buildErrorFeedback(lastFinalErrors)
            });

            const finalResponse = await withTimeout(
                generateWithRetry(prompt),
                LOOP_STEP_TIMEOUT_MS,
                'AI call fase selesai'
            );

            console.log(`[LOG LOOP] Respons final diterima pada percobaan ${attempt}`);

            // ── LEWATI_AKSI di fase final ──
            if (finalResponse.includes("STATUS: LEWATI_AKSI")) {
                let cleaned = cleanAiResponseForChat(finalResponse);
                if (!cleaned || cleaned.trim().length === 0) {
                    cleaned = "Proses diselesaikan dengan menyesuaikan batasan hak akses sistem grup.";
                }
                const summaryText = formatLoopSummary(ctx.stats);
                await updateStatusMessage(ctx.sock, ctx.remoteJid, `✅ *PROSES SELESAI & JAWABAN AKHIR*:\n\n${cleaned}\n\n${summaryText}`, ctx.statusKeyRef, getContextJids(ctx));
                return;
            }

            // ── Execute final actions ──
            checkCancelled(ctx.loopState);
            const finalActionResults = await executeAiActions(ctx.sock, ctx.remoteJid, finalResponse, ctx.destructiveCounter, ctx.msgContext);
            const finalFailedActions = finalActionResults.filter(r => r.status === 'FORBIDDEN' || r.status === 'ERROR');

            if (finalFailedActions.length > 0 && attempt < maxRetries) {
                lastFinalErrors = finalFailedActions.map(r => `- Gagal eksekusi [AKSI: ${r.name}]: ${r.detail}`).join('\n');
                ctx.stats.retryCount++;
                ctx.stats.failCount += finalFailedActions.length;
                await cancellableDelay(getRetryDelay(attempt), ctx.loopState);
                continue;
            }

            // ── Kirim jawaban akhir ──
            const successActions = finalActionResults.filter(r => r.status === 'SUCCESS');
            ctx.stats.successCount += successActions.length;
            ctx.stats.failCount += finalFailedActions.length;

            const finalCleanedResponse = cleanAiResponseForChat(finalResponse) + summarizeActionResults(finalActionResults);
            const summaryText = formatLoopSummary(ctx.stats);

            let textToDisplay = finalCleanedResponse.trim();
            if (!textToDisplay) {
                if (finalActionResults.length > 0) {
                    textToDisplay = summarizeActionResults(finalActionResults).trim();
                }
                if (!textToDisplay) {
                    textToDisplay = "Seluruh rangkaian instruksi telah selesai diproses.";
                }
            }

            await updateStatusMessage(ctx.sock, ctx.remoteJid, `✅ *PROSES SELESAI & JAWABAN AKHIR*:\n\n${textToDisplay}\n\n${summaryText}`, ctx.statusKeyRef, getContextJids(ctx));
            console.log(`[LOG LOOP] Proses Selesai sukses dikirim ke chat.`);
            return;
        } catch (err) {
            if (err instanceof LoopCancelledError) throw err;

            console.error(`[LOG LOOP ERROR] Gagal pada final phase percobaan ${attempt}:`, err.message);
            ctx.stats.retryCount++;

            if (attempt >= maxRetries) {
                const summaryText = formatLoopSummary(ctx.stats);
                await updateStatusMessage(ctx.sock, ctx.remoteJid, `[ERROR] Gagal merampungkan fase selesai.\n\n${summaryText}`, ctx.statusKeyRef, getContextJids(ctx));
                return;
            }

            await cancellableDelay(getRetryDelay(attempt), ctx.loopState);
        }
    }
}

// ─── Orchestrator Utama ─────────────────────────────────────────────────────

/**
 * Menjalankan Nested Autonomous Loop:
 *   Outer Loop (fase) → Inner Loop (langkah) → Retry Loop (percobaan)
 *   Lalu → Final Phase (jawaban akhir)
 */
async function runNestedAutonomousLoop(
    sock, remoteJid, initialPrompt, chatHistory, groupMetadataInfo, msgContext, botInternalNumber,
    maxOuterSteps = LOOP_MAX_OUTER_STEPS,
    maxInnerSteps = LOOP_MAX_INNER_STEPS
) {
    // ── Guard: Satu loop per grup ──
    if (activeLoops.has(remoteJid)) {
        console.log(`[LOG LOOP] Proses loop diabaikan karena sudah ada yang aktif di grup: ${remoteJid}`);
        await sock.sendMessage(remoteJid, { text: '[SYSTEM] Masih ada proses berjalan di grup ini. Ketik "stop" dulu untuk membatalkannya sebelum memulai proses baru.' });
        return;
    }

    // ── Setup Context ──
    const ctx = createLoopContext(sock, remoteJid, initialPrompt, chatHistory, groupMetadataInfo, msgContext, botInternalNumber, maxOuterSteps, maxInnerSteps);
    activeLoops.set(remoteJid, ctx.loopState);

    console.log(`[LOG LOOP START] Memulai Autonomous Loop untuk grup ${remoteJid} (max: ${maxOuterSteps}x${maxInnerSteps})`);

    try {
        // ── Kirim pesan status awal ──
        const statusMsg = await sock.sendMessage(remoteJid, {
            text: `[SYSTEM] Memulai Proses (Fase Iteratif 1/${maxOuterSteps})...\n(Ketik "stop" kapan saja untuk membatalkan)`
        });
        ctx.statusKeyRef = { key: statusMsg.key };

        // ── Outer Loop ──
        for (let outerStep = 1; outerStep <= maxOuterSteps; outerStep++) {
            checkCancelled(ctx.loopState);

            const phaseDone = await runInnerPhase(ctx, outerStep);

            if (phaseDone || outerStep >= maxOuterSteps) break;

            // Delay antar fase luar
            await cancellableDelay(getRetryDelay(1, 3000), ctx.loopState);
        }

        // ── Final Phase ──
        checkCancelled(ctx.loopState);
        await runFinalPhase(ctx);

    } catch (err) {
        if (err instanceof LoopCancelledError) {
            console.log(`[LOG LOOP] Proses dihentikan/dibatalkan oleh Owner.`);
            const summaryText = formatLoopSummary(ctx.stats, true);
            const logPreview = ctx.executionLog.length > 0
                ? ctx.executionLog.slice(-5).map(e => e.text).join('\n')
                : '(belum ada)';
            await updateStatusMessage(ctx.sock, ctx.remoteJid, `${summaryText}\n\nLog aksi terakhir:\n${logPreview}`, ctx.statusKeyRef, getContextJids(ctx));
        } else {
            console.error(`[LOG LOOP ERROR FATAL]:`, err.message);
            const summaryText = formatLoopSummary(ctx.stats);
            await updateStatusMessage(ctx.sock, ctx.remoteJid, `[ERROR] Terjadi kesalahan fatal: ${err.message}\n\n${summaryText}`, ctx.statusKeyRef, getContextJids(ctx)).catch(() => {});
        }
    } finally {
        console.log(`[LOG LOOP END] Melepaskan kunci activeLoops untuk grup: ${remoteJid}`);
        activeLoops.delete(remoteJid);
    }
}

/**
 * Membatalkan semua loop aktif (digunakan saat graceful shutdown).
 */
function cancelAllLoops() {
    for (const [remoteJid, loopState] of activeLoops.entries()) {
        log.warn('LOOP', `Membatalkan loop aktif di grup: ${remoteJid}`);
        loopState.cancel = true;
    }
}

module.exports = {
    activeLoops,
    runNestedAutonomousLoop,
    cancelAllLoops
};
