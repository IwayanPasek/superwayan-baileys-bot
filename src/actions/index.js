const memberActions = require('./memberActions');
const groupActions = require('./groupActions');
const messageActions = require('./messageActions');
const { MAX_DESTRUCTIVE_ACTIONS_PER_RUN } = require('../config/env');

const ACTION_HANDLERS = {
    ...memberActions,
    ...groupActions,
    ...messageActions
};

const DESTRUCTIVE_ACTIONS = new Set(['KICK', 'ADD', 'PROMOTE', 'DEMOTE', 'SEND_DM']);

function parseActions(aiResponseText) {
    console.log(`[LOG PARSER] Memparsing aksi dari teks respons AI...`);
    const regex = /\[AKSI:\s*([A-Z_]+)\s*(?:\|(.*?))?\]/gi;
    const actions = [];
    let match;
    while ((match = regex.exec(aiResponseText)) !== null) {
        const name = match[1].toUpperCase();
        const rawParams = match[2] !== undefined ? match[2].trim() : '';
        console.log(`[LOG PARSER] Ditemukan aksi -> Nama: ${name}, Parameter: ${rawParams}`);
        actions.push({ name, rawParams });
    }
    return actions;
}

async function executeAiActions(sock, remoteJid, aiResponseText, destructiveCounter, msgContext) {
    const actions = parseActions(aiResponseText);
    const results = [];

    for (const action of actions) {
        const handler = ACTION_HANDLERS[action.name];
        if (!handler) {
            console.log(`[LOG ACTION WARNING] Aksi tidak dikenal: ${action.name}`);
            results.push({ name: action.name, status: 'UNKNOWN', detail: 'Aksi tidak valid' });
            continue;
        }

        if (DESTRUCTIVE_ACTIONS.has(action.name) && destructiveCounter.count >= MAX_DESTRUCTIVE_ACTIONS_PER_RUN) {
            console.log(`[LOG ACTION CAPPED] Batas aksi destruktif tercapai untuk ${action.name}`);
            results.push({ name: action.name, status: 'CAPPED', detail: 'Batas aksi maksimal tercapai' });
            continue;
        }

        try {
            console.log(`[LOG ACTION EXECUTE] Menjalankan handler untuk aksi: ${action.name} | params: ${JSON.stringify(action.rawParams)}`);
            const outcome = await handler(sock, remoteJid, action.rawParams, msgContext);
            if (outcome && outcome.skipped) {
                console.log(`[LOG ACTION SKIPPED] Aksi ${action.name} dilewati: ${outcome.reason}`);
                results.push({ name: action.name, status: 'SKIPPED', detail: outcome.reason });
            } else {
                if (DESTRUCTIVE_ACTIONS.has(action.name)) destructiveCounter.count++;
                console.log(`[LOG ACTION SUCCESS] Aksi ${action.name} berhasil dieksekusi.`);
                results.push({ name: action.name, status: 'SUCCESS', detail: outcome });
            }
        } catch (err) {
            const msg = (err.message || '').toLowerCase();
            const forbidden = msg.includes('forbidden') || msg.includes('admin') || msg.includes('not authorized') || msg.includes('403') || msg.includes('406') || msg.includes('ditolak');
            console.error(`[LOG ACTION ERROR] Gagal mengeksekusi aksi ${action.name}:`, err.message);
            
            results.push({ 
                name: action.name, 
                status: forbidden ? 'FORBIDDEN' : 'ERROR', 
                detail: err.message || 'Error tidak diketahui dari sistem WhatsApp' 
            });
        }
    }

    return results;
}

module.exports = {
    ACTION_HANDLERS,
    DESTRUCTIVE_ACTIONS,
    parseActions,
    executeAiActions
};
