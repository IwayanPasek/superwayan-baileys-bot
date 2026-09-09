const memberActions = require('./memberActions');
const groupActions = require('./groupActions');
const messageActions = require('./messageActions');
const { MAX_DESTRUCTIVE_ACTIONS_PER_RUN } = require('../config/env');
const log = require('../utils/logger');

const ACTION_HANDLERS = {
    ...memberActions,
    ...groupActions,
    ...messageActions
};

const DESTRUCTIVE_ACTIONS = new Set(['KICK', 'ADD', 'PROMOTE', 'DEMOTE', 'SEND_DM']);

// Timeout per aksi individual (15 detik) — mencegah satu aksi hang memblokir seluruh eksekusi
const ACTION_TIMEOUT_MS = 15000;

function parseActions(aiResponseText) {
    log.debug('PARSER', 'Memparsing aksi dari teks respons AI...');
    const regex = /\[AKSI:\s*([A-Z_]+)\s*(?:\|(.*?))?\]/gi;
    const actions = [];
    let match;
    while ((match = regex.exec(aiResponseText)) !== null) {
        const name = match[1].toUpperCase();
        const rawParams = match[2] !== undefined ? match[2].trim() : '';
        log.debug('PARSER', `Ditemukan aksi -> Nama: ${name}, Parameter: ${rawParams}`);
        actions.push({ name, rawParams });
    }
    return actions;
}

/**
 * Membungkus eksekusi handler dengan timeout.
 */
function withActionTimeout(handlerPromise, actionName, timeoutMs = ACTION_TIMEOUT_MS) {
    const timer = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`ACTION_TIMEOUT: Aksi ${actionName} melebihi ${timeoutMs}ms`)), timeoutMs)
    );
    return Promise.race([handlerPromise, timer]);
}

async function executeAiActions(sock, remoteJid, aiResponseText, destructiveCounter, msgContext) {
    const actions = parseActions(aiResponseText);
    const results = [];

    if (actions.length === 0) return results;

    log.info('ACTION', `Menjalankan ${actions.length} aksi...`);

    for (const action of actions) {
        const handler = ACTION_HANDLERS[action.name];
        if (!handler) {
            log.warn('ACTION', `Aksi tidak dikenal: ${action.name}`);
            results.push({ name: action.name, status: 'UNKNOWN', detail: 'Aksi tidak valid' });
            continue;
        }

        if (DESTRUCTIVE_ACTIONS.has(action.name) && destructiveCounter.count >= MAX_DESTRUCTIVE_ACTIONS_PER_RUN) {
            log.warn('ACTION', `Batas aksi destruktif tercapai untuk ${action.name}`);
            results.push({ name: action.name, status: 'CAPPED', detail: 'Batas aksi maksimal tercapai' });
            continue;
        }

        const startTime = Date.now();
        try {
            log.info('ACTION', `Menjalankan: ${action.name} | params: ${action.rawParams}`);

            const outcome = await withActionTimeout(
                handler(sock, remoteJid, action.rawParams, msgContext),
                action.name
            );

            const durationMs = Date.now() - startTime;

            if (outcome && outcome.skipped) {
                log.info('ACTION', `${action.name} dilewati (${durationMs}ms): ${outcome.reason}`);
                results.push({ name: action.name, status: 'SKIPPED', detail: outcome.reason });
            } else {
                if (DESTRUCTIVE_ACTIONS.has(action.name)) destructiveCounter.count++;
                log.info('ACTION', `${action.name} berhasil (${durationMs}ms)`);
                results.push({ name: action.name, status: 'SUCCESS', detail: outcome });
            }
        } catch (err) {
            const durationMs = Date.now() - startTime;
            const msg = (err.message || '').toLowerCase();
            const forbidden = msg.includes('forbidden') || msg.includes('admin') || msg.includes('not authorized') || msg.includes('403') || msg.includes('406') || msg.includes('ditolak');
            const isTimeout = msg.includes('action_timeout');

            if (isTimeout) {
                log.error('ACTION', `${action.name} TIMEOUT (${durationMs}ms)`, err);
                results.push({ name: action.name, status: 'ERROR', detail: `Timeout setelah ${ACTION_TIMEOUT_MS}ms` });
            } else {
                log.error('ACTION', `${action.name} GAGAL (${durationMs}ms)`, err);
                results.push({
                    name: action.name,
                    status: forbidden ? 'FORBIDDEN' : 'ERROR',
                    detail: err.message || 'Error tidak diketahui dari sistem WhatsApp'
                });
            }
        }
    }

    // Log ringkasan hasil
    const successCount = results.filter(r => r.status === 'SUCCESS').length;
    const failCount = results.filter(r => ['FORBIDDEN', 'ERROR'].includes(r.status)).length;
    log.info('ACTION', `Selesai: ${successCount}/${results.length} berhasil${failCount > 0 ? `, ${failCount} gagal` : ''}`);

    return results;
}

module.exports = {
    ACTION_HANDLERS,
    DESTRUCTIVE_ACTIONS,
    parseActions,
    executeAiActions
};
