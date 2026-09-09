const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');

const { AI_PROVIDER, OWNER_NUMBER, OWNER_LID, BOT_NUMBER } = require('../config/env');
const { simulateActivity, sendReaction } = require('../utils/interaction');
const { checkMessageModeration, getGroupActivitySummary, groupMessageHistory, checkCooldown } = require('../utils/moderation');
const { extractMessageContent } = require('../utils/messageHelper');
const { activeLoops, runNestedAutonomousLoop, cancelAllLoops } = require('../runners/autonomousLoop');
const { runSinglePromptWithRetry } = require('../runners/singlePrompt');
const log = require('../utils/logger');

// ─── Helper: Cek Apakah Pengirim adalah Owner ───────────────────────────────
function isOwnerMessage(senderJid, remoteJid) {
    return (
        (OWNER_NUMBER && (senderJid === OWNER_NUMBER || remoteJid === OWNER_NUMBER)) ||
        (OWNER_LID && (senderJid === OWNER_LID || remoteJid === OWNER_LID))
    );
}

// ─── Helper: Cek Apakah Bot di-Tag ──────────────────────────────────────────
function isBotTagged(mentionedJidList, messageText, botInternalNumber, quotedMessageKey) {
    const cleanBotNum = BOT_NUMBER ? BOT_NUMBER.replace(/[^0-9]/g, '') : '';
    const mentionMatch = mentionedJidList.some(jid =>
        (botInternalNumber && jid.includes(botInternalNumber)) ||
        (cleanBotNum && jid.includes(cleanBotNum))
    );
    const textMatch =
        (botInternalNumber && messageText.includes(`@${botInternalNumber}`)) ||
        (cleanBotNum && messageText.includes(`@${cleanBotNum}`));
    const quoteMatch = quotedMessageKey ? quotedMessageKey.fromMe : false;
    
    return mentionMatch || textMatch || quoteMatch;
}

// ─── Helper: Bersihkan Mention Bot dari Teks ────────────────────────────────
function stripBotMentions(text, botInternalNumber) {
    let cleaned = text;
    if (botInternalNumber) {
        cleaned = cleaned.replace(new RegExp(`@${botInternalNumber}\\b`, 'g'), '');
    }
    if (BOT_NUMBER) {
        const cleanBot = BOT_NUMBER.replace(/[^0-9]/g, '');
        if (cleanBot && cleanBot !== botInternalNumber) {
            cleaned = cleaned.replace(new RegExp(`@${cleanBot}\\b`, 'g'), '');
        }
    }
    return cleaned.trim();
}

// ─── Helper: Simpan Riwayat Pesan Grup ──────────────────────────────────────
function recordGroupMessage(remoteJid, senderJid, messageText) {
    if (!groupMessageHistory[remoteJid]) {
        groupMessageHistory[remoteJid] = [];
    }
    groupMessageHistory[remoteJid].push(`Sender: ${senderJid} -> ${messageText}`);
    if (groupMessageHistory[remoteJid].length > 50) {
        groupMessageHistory[remoteJid].shift();
    }
}

// ─── Handler: Perintah Stop Loop ────────────────────────────────────────────
async function handleLoopCancel(sock, msg, remoteJid, messageText) {
    const lower = messageText.toLowerCase().trim();
    if (lower === 'stop' || lower === 'berhenti' || lower === 'batalkan') {
        log.info('LOOP', `Perintah stop/berhenti diterima dari Owner untuk grup ${remoteJid}`);
        activeLoops.get(remoteJid).cancel = true;
        await sock.sendMessage(remoteJid, {
            text: '[SYSTEM] Permintaan pembatalan diterima, menghentikan proses setelah langkah saat ini selesai...'
        }, { quoted: msg });
        return true;
    }
    return false;
}

// ─── Handler: Pemrosesan Perintah Owner ─────────────────────────────────────
async function handleOwnerCommand(sock, msg, promptText, isGroup, mentionedJidList, botInternalNumber, senderJid, quotedMessageKey) {
    const remoteJid = msg.key.remoteJid;

    // Perintah kosong (hanya tag bot tanpa instruksi)
    if (!promptText) {
        await sock.sendMessage(remoteJid, {
            text: "Halo Owner. Ada instruksi atau tugas yang ingin saya proses?"
        }, { quoted: msg });
        return;
    }

    // Berikan reaksi emoji tanda bot sedang memproses
    sendReaction(sock, remoteJid, msg.key, '🤖').catch(() => {});

    // Perintah ringkasan aktivitas grup (Analytics)
    const promptLower = promptText.toLowerCase();
    if (promptLower.includes('ringkasan aktivitas') && isGroup) {
        log.info('ANALYTICS', 'Owner meminta ringkasan aktivitas grup');
        const summary = getGroupActivitySummary(remoteJid);
        await sock.sendMessage(remoteJid, { text: summary }, { quoted: msg });
        return;
    }

    // Deteksi trigger autonomous loop
    const isLoopTrigger = promptLower.includes("loop") ||
        promptLower.includes("lanjutkan terus") ||
        promptLower.includes("proses berkelanjutan");

    if (isLoopTrigger && isGroup) {
        log.info('LOOP', 'Pemicu autonomous loop terdeteksi');
        try {
            const currentHistory = groupMessageHistory[remoteJid] || [];
            const groupMeta = await sock.groupMetadata(remoteJid);
            const groupMetaInfo = {
                subject: groupMeta.subject,
                desc: groupMeta.desc || '',
                participants: groupMeta.participants
            };
            runNestedAutonomousLoop(sock, remoteJid, promptText, currentHistory, groupMetaInfo, {
                quotedMessageKey,
                mentionedJid: mentionedJidList
            }, botInternalNumber);
        } catch (metaErr) {
            log.error('LOOP', 'Gagal membaca metadata grup untuk loop', metaErr);
            await sock.sendMessage(remoteJid, {
                text: 'Maaf, gagal memulai proses (tidak bisa membaca info grup).'
            }, { quoted: msg });
        }
    } else {
        // Single prompt (non-loop)
        await runSinglePromptWithRetry(sock, msg, promptText, isGroup, mentionedJidList, botInternalNumber, senderJid, quotedMessageKey);
    }
}

// ─── Handler Utama: Message Upsert ──────────────────────────────────────────
async function handleMessageUpsert(sock, messages, type) {
    if (type !== 'notify') return;

    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const senderJid = msg.key.participant || msg.key.remoteJid;
    const remoteJid = msg.key.remoteJid;
    const isGroup = remoteJid.endsWith('@g.us');
    const botInternalNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : '';
    const { text: messageText, mentionedJid: mentionedJidList, quotedMessageKey } = extractMessageContent(msg, botInternalNumber);

    if (!messageText) return;

    log.debug('MESSAGE', `Pesan masuk dari ${senderJid} di ${isGroup ? 'Grup' : 'Privat'}: "${messageText.substring(0, 50)}..."`);

    const isOwner = isOwnerMessage(senderJid, remoteJid);

    // Fitur Auto-Read & Simulating Typing
    simulateActivity(sock, remoteJid, msg.key).catch(() => {});

    // Fitur Moderasi Anti-Link
    const moderation = checkMessageModeration(messageText, isOwner);
    if (!moderation.safe && isGroup) {
        log.info('MODERATION', 'Melanggar aturan anti-link. Menghapus pesan dan memperingatkan pengirim.');
        await sock.sendMessage(remoteJid, { delete: msg.key });
        await sock.sendMessage(remoteJid, { text: `⚠️ Pesan dihapus: ${moderation.reason}` }, { quoted: msg });
        return;
    }

    // Simpan riwayat percakapan grup
    if (isGroup) {
        recordGroupMessage(remoteJid, senderJid, messageText);
    }

    // Handle perintah stop loop dari Owner
    if (isOwner && isGroup && activeLoops.has(remoteJid)) {
        const handled = await handleLoopCancel(sock, msg, remoteJid, messageText);
        if (handled) return;
    }

    // Cek apakah bot di-tag
    const isTagged = isBotTagged(mentionedJidList, messageText, botInternalNumber, quotedMessageKey);
    log.debug('ACCESS', `Evaluasi Tag - isTagged: ${isTagged}, isOwner: ${isOwner}, isGroup: ${isGroup}, botInternalNumber: ${botInternalNumber}`);

    // Tolak akses member biasa yang tag bot
    if (isTagged && !isOwner) {
        log.info('ACCESS', `Ditolak: Member biasa (${senderJid}) men-tag bot`);

        // Cooldown anti-spam: 1 pesan tolak per user per 30 detik
        if (!checkCooldown(senderJid, 30000)) return;

        await sock.sendMessage(remoteJid, {
            text: "Mohon maaf, fitur tanya-jawab AI (Prompting) via tag hanya dapat diakses oleh Owner bot."
        }, { quoted: msg });
        return;
    }

    // Proses perintah dari Owner
    if (isOwner && ((isGroup && isTagged) || (!isGroup))) {
        log.info('ACCESS', 'Diterima: Pesan sah dari Owner');

        const promptText = stripBotMentions(messageText, botInternalNumber);
        await handleOwnerCommand(sock, msg, promptText, isGroup, mentionedJidList, botInternalNumber, senderJid, quotedMessageKey);
    }
}

// ─── Koneksi WhatsApp ───────────────────────────────────────────────────────

async function startWhatsAppBot() {
    log.info('BOT', 'Memulai inisialisasi WhatsApp Socket (makeWASocket)...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("===========================================");
            console.log("[LOG QR] SCAN QR CODE BARU DI BAWAH INI:");
            console.log("===========================================");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            log.warn('CONNECTION', `Koneksi terputus dengan kode status: ${statusCode}`);
            if (statusCode === DisconnectReason.loggedOut) {
                log.warn('CONNECTION', 'Sesi terhapus karena logout. Membersihkan folder auth_info...');
                if (fs.existsSync('./auth_info')) {
                    fs.rmSync('./auth_info', { recursive: true, force: true });
                }
                setTimeout(startWhatsAppBot, 3000);
            } else {
                log.info('CONNECTION', 'Menyambungkan ulang bot dalam 5 detik...');
                setTimeout(startWhatsAppBot, 5000);
            }
        } else if (connection === 'open') {
            log.info('CONNECTION', `Bot WhatsApp Berhasil Terhubung! Provider: ${AI_PROVIDER.toUpperCase()}`);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            await handleMessageUpsert(sock, messages, type);
        } catch (handlerErr) {
            log.fatal('MESSAGE', 'Error fatal pada messages.upsert handler', handlerErr);
        }
    });
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

function setupGracefulShutdown() {
    const shutdown = (signal) => {
        log.warn('SHUTDOWN', `Sinyal ${signal} diterima. Membatalkan semua loop aktif...`);
        cancelAllLoops();
        log.info('SHUTDOWN', 'Proses akan dihentikan dalam 2 detik...');
        setTimeout(() => process.exit(0), 2000);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = {
    startWhatsAppBot,
    setupGracefulShutdown
};
