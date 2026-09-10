const { toJid } = require('../utils/jid');
const { ENABLE_SEND_DM } = require('../config/env');
const { sendGroupPoll, scheduleTask } = require('../utils/interaction');
const { popRecentBotMessages } = require('../utils/botMessageHistory');

const messageActions = {
    SEND_DM: async (sock, remoteJid, rawParams) => {
        if (!ENABLE_SEND_DM) return { skipped: true, reason: 'fitur SEND_DM dimatikan' };
        const pipeIndex = rawParams.indexOf('|');
        const targetRaw = pipeIndex === -1 ? rawParams : rawParams.slice(0, pipeIndex);
        const dmMessage = pipeIndex === -1 ? '' : rawParams.slice(pipeIndex + 1).trim();
        const targetJid = toJid(targetRaw);
        if (!targetJid || !dmMessage) throw new Error('Nomor atau isi pesan SEND_DM tidak lengkap');
        console.log(`[LOG ACTION SEND_DM] Mengirim pesan pribadi ke ${targetJid}`);
        await sock.sendMessage(targetJid, { text: dmMessage });
        return `DM terkirim ke ${targetJid}`;
    },
    MENTION: async (sock, remoteJid, rawParams) => {
        const targetJid = toJid(rawParams);
        if (!targetJid) throw new Error('Target MENTION kosong/tidak valid');
        console.log(`[LOG ACTION MENTION] Menyebut (mention) ${targetJid} di grup ${remoteJid}`);
        await sock.sendMessage(remoteJid, { text: `Halo @${targetJid.split('@')[0]}, Anda dipanggil oleh sistem.`, mentions: [targetJid] });
        return `Mention terkirim ke ${targetJid}`;
    },
    PROFILE_INFO: async (sock, remoteJid, rawParams) => {
        const targetJid = toJid(rawParams);
        if (!targetJid) throw new Error('Target PROFILE_INFO kosong/tidak valid');
        let statusInfo = "Tidak dapat mengambil status.";
        try {
            console.log(`[LOG ACTION PROFILE] Mengambil status publik untuk ${targetJid}`);
            const status = await sock.fetchStatus(targetJid);
            statusInfo = status?.status || "Tidak ada status.";
        } catch (e) { }
        await sock.sendMessage(remoteJid, { text: `Informasi Profil Publik untuk ${targetJid.split('@')[0]}:\nStatus/Bio: ${statusInfo}` });
        return `Info profil ${targetJid} dikirim`;
    },
    FORWARD: async (sock, remoteJid, rawParams) => {
        const fwdText = (rawParams || '').trim();
        if (!fwdText) throw new Error('Isi FORWARD kosong');
        console.log(`[LOG ACTION FORWARD] Meneruskan teks di ${remoteJid}`);
        await sock.sendMessage(remoteJid, { text: `[Pesan Diteruskan]:\n${fwdText}` });
        return `Pesan diteruskan`;
    },
    POLL: async (sock, remoteJid, rawParams) => {
        const pipeIndex = rawParams.indexOf('|');
        if (pipeIndex === -1) throw new Error('Format POLL tidak valid');
        const pollTitle = rawParams.slice(0, pipeIndex).trim();
        const options = rawParams.slice(pipeIndex + 1).split(',').map(o => o.trim()).filter(Boolean);
        console.log(`[LOG ACTION POLL] Membuat poling: "${pollTitle}"`);
        await sendGroupPoll(sock, remoteJid, pollTitle, options);
        return `Poling "${pollTitle}" dikirim`;
    },
    SCHEDULE: async (sock, remoteJid, rawParams) => {
        const pipeIndex = rawParams.indexOf('|');
        if (pipeIndex === -1) throw new Error('Format SCHEDULE tidak valid');
        const minutes = parseInt(rawParams.slice(0, pipeIndex).trim(), 10) || 5;
        const reminderText = rawParams.slice(pipeIndex + 1).trim();
        console.log(`[LOG ACTION SCHEDULE] Menjadwalkan pengingat dalam ${minutes} menit`);
        scheduleTask(sock, remoteJid, reminderText, minutes);
        return `Tugas terjadwal dalam ${minutes} menit`;
    },
    DELETE: async (sock, remoteJid, rawParams, msgContext) => {
        const { checkParticipantPrivileges } = require('../utils/privileges');
        const botJid = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
        
        // Cek status bot di grup
        let botIsAdmin = false;
        if (remoteJid.endsWith('@g.us') && botJid) {
            const priv = await checkParticipantPrivileges(sock, remoteJid, botJid);
            botIsAdmin = priv.isAdmin || priv.isSuperAdmin;
        } else {
            botIsAdmin = true; // Privat chat, bot selalu bisa menghapus pesannya sendiri
        }

        if (msgContext && msgContext.quotedMessageKey) {
            const key = msgContext.quotedMessageKey;
            console.log(`[LOG ACTION DELETE] Evaluasi hapus pesan: fromMe=${key.fromMe}, botIsAdmin=${botIsAdmin}`);
            
            if (!key.fromMe && !botIsAdmin) {
                throw new Error('Aksi ditolak: Bot tidak memiliki hak admin untuk menghapus pesan orang lain (Bot hanya dapat menghapus pesannya sendiri).');
            }
            
            await sock.sendMessage(remoteJid, { delete: key });
            return key.fromMe ? `Menghapus pesan (bot) yang dibalas` : `Menghapus pesan anggota yang dibalas`;
        }
        
        const params = (rawParams || '').trim();
        if (!params) throw new Error('GAGAL: Owner tidak me-reply (quote) pesan apapun. [AKSI: DELETE] HANYA bisa digunakan jika Owner me-reply pesan target. Jika Owner menyuruh menghapus pesan bot itu sendiri, gunakan [AKSI: UNDO | jumlah].');

        const [targetId, participantRaw] = params.split('|').map(s => (s || '').trim());
        if (!targetId) throw new Error('ID pesan tidak valid');

        const deleteKey = {
            remoteJid: remoteJid,
            id: targetId,
            fromMe: false
        };
        if (participantRaw) {
            deleteKey.participant = toJid(participantRaw);
        }
        
        if (!botIsAdmin) {
            throw new Error('Aksi ditolak: Bot bukan admin sehingga tidak bisa menghapus pesan berdasarkan ID dari orang lain.');
        }

        console.log(`[LOG ACTION DELETE] Menghapus pesan dengan ID: ${targetId} di ${remoteJid}`);
        await sock.sendMessage(remoteJid, { delete: deleteKey });
        return `Menghapus pesan dengan ID: ${targetId}`;
    },
    UNDO: async (sock, remoteJid, rawParams, msgContext) => {
        // Jika ada pesan spesifik dari bot yang di-reply/dikutip
        if (msgContext && msgContext.quotedMessageKey && msgContext.quotedMessageKey.fromMe) {
            console.log(`[LOG ACTION UNDO] Menghapus pesan (bot) yang di-reply di ${remoteJid}`);
            await sock.sendMessage(remoteJid, { delete: msgContext.quotedMessageKey });
            return `Menghapus (undo) pesan yang Anda reply.`;
        }
        
        // Hapus berdasarkan recent history
        const count = parseInt((rawParams || '').trim(), 10) || 1;
        const keys = popRecentBotMessages(remoteJid, count);
        if (keys.length === 0) throw new Error('Tidak ada pesan terbaru bot yang tercatat untuk dihapus');
        
        let deleted = 0;
        for (const key of keys) {
            try {
                await sock.sendMessage(remoteJid, { delete: key });
                deleted++;
            } catch (e) {
                console.error('[LOG ACTION UNDO] Gagal hapus pesan bot:', e.message);
            }
        }
        if (deleted === 0) throw new Error('Gagal menghapus pesan (mungkin sudah dihapus/kadaluarsa)');
        return `Berhasil menghapus (undo) ${deleted} pesan terakhir bot.`;
    },
    TAG_ALL: async (sock, remoteJid, rawParams) => {
        let meta;
        try {
            meta = await sock.groupMetadata(remoteJid);
        } catch (e) {
            throw new Error('Gagal mendapatkan daftar peserta grup');
        }
        if (!meta || !meta.participants) {
            throw new Error('Data peserta grup tidak tersedia');
        }
        
        const message = rawParams ? rawParams.trim() : 'Halo semua, Anda dipanggil oleh sistem.';
        const participants = meta.participants.map(p => p.id);
        
        let mentionsText = '';
        participants.forEach(jid => {
            mentionsText += `@${jid.split('@')[0]} `;
        });
        
        const fullMessage = `${message}\n\n${mentionsText.trim()}`;
        console.log(`[LOG ACTION TAG_ALL] Men-tag ${participants.length} anggota di ${remoteJid}`);
        await sock.sendMessage(remoteJid, { text: fullMessage, mentions: participants });
        return `Berhasil men-tag ${participants.length} anggota.`;
    }
};

module.exports = messageActions;
