const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');

const { AI_PROVIDER, OWNER_NUMBER, OWNER_LID, BOT_NUMBER } = require('../config/env');
const { simulateActivity, sendReaction } = require('../utils/interaction');
const { checkMessageModeration, getGroupActivitySummary, groupMessageHistory } = require('../utils/moderation');
const { extractMessageContent } = require('../utils/messageHelper');
const { activeLoops, runNestedAutonomousLoop } = require('../runners/autonomousLoop');
const { runSinglePromptWithRetry } = require('../runners/singlePrompt');

async function startWhatsAppBot() {
    console.log('[LOG BOT] Memulai inisialisasi WhatsApp Socket (makeWASocket)...');
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
            console.log(`[LOG CONNECTION] Koneksi terputus dengan kode status: ${statusCode}`);
            if (statusCode === DisconnectReason.loggedOut) {
                console.log('[LOG CONNECTION] Sesi terhapus karena logout. Membersihkan folder auth_info...');
                if (fs.existsSync('./auth_info')) {
                    fs.rmSync('./auth_info', { recursive: true, force: true });
                }
                setTimeout(startWhatsAppBot, 3000);
            } else {
                console.log('[LOG CONNECTION] Menyambungkan ulang bot dalam 5 detik...');
                setTimeout(startWhatsAppBot, 5000);
            }
        } else if (connection === 'open') {
            console.log(`[LOG CONNECTION SUCCESS] Bot WhatsApp Berhasil Terhubung! Menggunakan Provider: ${AI_PROVIDER.toUpperCase()}`);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;

            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const senderJid = msg.key.participant || msg.key.remoteJid;
            const isGroup = msg.key.remoteJid.endsWith('@g.us');
            const botInternalNumber = sock.user?.id ? sock.user.id.split(':')[0] : '';
            const { text: messageText, mentionedJid: mentionedJidList, quotedMessageKey } = extractMessageContent(msg, botInternalNumber);

            if (!messageText) return;

            console.log(`[LOG MESSAGE] Pesan masuk dari ${senderJid} di ${isGroup ? 'Grup' : 'Privat'}: "${messageText.substring(0, 50)}..."`);

            const isOwner = (
                senderJid === OWNER_NUMBER ||
                msg.key.remoteJid === OWNER_NUMBER ||
                (OWNER_LID && senderJid === OWNER_LID)
            );

            // Fitur Auto-Read & Simulating Typing
            await simulateActivity(sock, msg.key.remoteJid, msg.key);

            // Fitur Moderasi Anti-Link
            const moderation = checkMessageModeration(messageText, isOwner);
            if (!moderation.safe && isGroup) {
                console.log(`[LOG MODERATION] Melanggar aturan anti-link. Menghapus pesan dan memperingatkan pengirim.`);
                await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
                await sock.sendMessage(msg.key.remoteJid, { text: `⚠️ Pesan dihapus: ${moderation.reason}` }, { quoted: msg });
                return;
            }

            if (isGroup) {
                if (!groupMessageHistory[msg.key.remoteJid]) {
                    groupMessageHistory[msg.key.remoteJid] = [];
                }
                groupMessageHistory[msg.key.remoteJid].push(`Sender: ${senderJid} -> ${messageText}`);
                if (groupMessageHistory[msg.key.remoteJid].length > 50) {
                    groupMessageHistory[msg.key.remoteJid].shift();
                }
            }

            if (isOwner && isGroup && activeLoops.has(msg.key.remoteJid)) {
                const lower = messageText.toLowerCase().trim();
                if (lower === 'stop' || lower === 'berhenti' || lower === 'batalkan') {
                    console.log(`[LOG LOOP] Perintah stop/berhenti diterima dari Owner untuk grup ${msg.key.remoteJid}`);
                    activeLoops.get(msg.key.remoteJid).cancel = true;
                    await sock.sendMessage(msg.key.remoteJid, { text: '[SYSTEM] Permintaan pembatalan diterima, menghentikan proses setelah langkah saat ini selesai...' }, { quoted: msg });
                    return;
                }
            }

            const isTagged =
                mentionedJidList.some(jid => (botInternalNumber && jid.includes(botInternalNumber)) || (BOT_NUMBER && jid.includes(BOT_NUMBER))) ||
                (botInternalNumber && messageText.includes(`@${botInternalNumber}`)) ||
                (BOT_NUMBER && messageText.includes(`@${BOT_NUMBER}`));

            if (isTagged && !isOwner) {
                console.log(`[LOG ACCESS] Ditolak: Member biasa (${senderJid}) men-tag bot.`);
                const memberHelpText = "Mohon maaf, fitur tanya-jawab AI (Prompting) via tag hanya dapat diakses oleh Owner bot.";
                await sock.sendMessage(msg.key.remoteJid, { text: memberHelpText }, { quoted: msg });
                return;
            }

            if (isOwner && ((isGroup && isTagged) || (!isGroup))) {
                console.log(`[LOG ACCESS] Diterima: Pesan sah dari Owner.`);
                
                // Bersihkan hanya mention bot agar tag anggota lain/nomor target tetap utuh untuk konteks AI
                let promptText = messageText;
                if (botInternalNumber) {
                    promptText = promptText.replace(new RegExp(`@${botInternalNumber}\\b`, 'g'), '');
                }
                if (BOT_NUMBER) {
                    const cleanBot = BOT_NUMBER.replace(/[^0-9]/g, '');
                    if (cleanBot && cleanBot !== botInternalNumber) {
                        promptText = promptText.replace(new RegExp(`@${cleanBot}\\b`, 'g'), '');
                    }
                }
                promptText = promptText.trim();

                if (!promptText) {
                    await sock.sendMessage(msg.key.remoteJid, { text: "Halo Owner. Ada instruksi atau tugas yang ingin saya proses?" }, { quoted: msg });
                    return;
                }

                // Berikan reaksi emoji tanda bot sedang memproses
                await sendReaction(sock, msg.key.remoteJid, msg.key, '🤖');

                // Perintah ringkasan aktivitas grup (Analytics)
                if (promptText.toLowerCase().includes('ringkasan aktivitas') && isGroup) {
                    console.log(`[LOG ANALYTICS] Owner meminta ringkasan aktivitas grup.`);
                    const summary = getGroupActivitySummary(msg.key.remoteJid);
                    await sock.sendMessage(msg.key.remoteJid, { text: summary }, { quoted: msg });
                    return;
                }

                const isLoopTrigger = promptText.toLowerCase().includes("loop") || promptText.toLowerCase().includes("lanjutkan terus") || promptText.toLowerCase().includes("proses berkelanjutan");

                if (isLoopTrigger && isGroup) {
                    console.log(`[LOG LOOP] Pemicu autonomous loop terdeteksi.`);
                    try {
                        const currentHistory = groupMessageHistory[msg.key.remoteJid] || [];
                        const groupMeta = await sock.groupMetadata(msg.key.remoteJid);
                        const groupMetaInfo = {
                            subject: groupMeta.subject,
                            desc: groupMeta.desc || '',
                            participants: groupMeta.participants
                        };
                        runNestedAutonomousLoop(sock, msg.key.remoteJid, promptText, currentHistory, groupMetaInfo, { quotedMessageKey, mentionedJid: mentionedJidList }, botInternalNumber);
                    } catch (metaErr) {
                        console.error('[LOG ERROR] Gagal membaca metadata grup untuk loop:', metaErr.message);
                        await sock.sendMessage(msg.key.remoteJid, { text: 'Maaf, gagal memulai proses (tidak bisa membaca info grup).' }, { quoted: msg });
                    }
                } else {
                    await runSinglePromptWithRetry(sock, msg, promptText, isGroup, mentionedJidList, botInternalNumber, senderJid, quotedMessageKey);
                }
            }
        } catch (handlerErr) {
            console.error('[LOG ERROR FATAL messages.upsert]:', handlerErr.message);
        }
    });
}

module.exports = {
    startWhatsAppBot
};
