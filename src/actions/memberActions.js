const { toJid, parseTargetJids } = require('../utils/jid');
const { checkParticipantPrivileges } = require('../utils/privileges');
const { ENABLE_ADD_MEMBER } = require('../config/env');

const memberActions = {
    KICK: async (sock, remoteJid, rawParams) => {
        const targetJids = parseTargetJids(rawParams);
        if (targetJids.length === 0) throw new Error('Target KICK kosong/tidak valid');
        
        let metadata = null;
        try {
            metadata = await sock.groupMetadata(remoteJid);
        } catch (e) {
            console.error(`[LOG ACTION KICK] Gagal mengambil metadata grup:`, e.message);
        }

        const botJid = sock.user?.id ? toJid(sock.user.id.split(':')[0]) : null;
        const validTargets = [];
        const rejectedReasons = [];

        for (const targetJid of targetJids) {
            if (botJid && targetJid === botJid) {
                rejectedReasons.push(`${targetJid.split('@')[0]} (Bot tidak dapat mengeluarkan diri sendiri)`);
                continue;
            }

            const priv = await checkParticipantPrivileges(sock, remoteJid, targetJid, metadata);
            if (!priv.exists) {
                rejectedReasons.push(`${targetJid.split('@')[0]} (Tidak ditemukan di grup)`);
                continue;
            }
            if (priv.isSuperAdmin) {
                rejectedReasons.push(`${targetJid.split('@')[0]} (Creator/Owner grup tidak dapat dikeluarkan)`);
                continue;
            }
            if (priv.isAdmin) {
                rejectedReasons.push(`${targetJid.split('@')[0]} (Admin grup tidak dapat dikeluarkan)`);
                continue;
            }

            validTargets.push(priv.actualJid || targetJid);
        }

        if (validTargets.length === 0) {
            throw new Error(`Aksi KICK ditolak sistem:\n${rejectedReasons.map(r => `- ${r}`).join('\n')}`);
        }

        console.log(`[LOG ACTION KICK] Mengeksekusi remove partisipan [${validTargets.join(', ')}] dari ${remoteJid}`);
        await sock.groupParticipantsUpdate(remoteJid, validTargets, "remove");

        const kickedStr = validTargets.map(j => j.split('@')[0]).join(', ');
        let resultMessage = `Mengeluarkan: ${kickedStr}`;
        if (rejectedReasons.length > 0) {
            resultMessage += ` (Dilewati: ${rejectedReasons.join(', ')})`;
        }
        return resultMessage;
    },
    ADD: async (sock, remoteJid, rawParams) => {
        if (!ENABLE_ADD_MEMBER) return { skipped: true, reason: 'fitur ADD dimatikan' };
        const targetJid = toJid(rawParams);
        if (!targetJid) throw new Error('Target ADD kosong/tidak valid');
        console.log(`[LOG ACTION ADD] Mengeksekusi add partisipan ${targetJid} ke ${remoteJid}`);
        await sock.groupParticipantsUpdate(remoteJid, [targetJid], "add");
        return `Menambahkan ${targetJid}`;
    },
    PROMOTE: async (sock, remoteJid, rawParams) => {
        const targetJid = toJid(rawParams);
        if (!targetJid) throw new Error('Target PROMOTE kosong/tidak valid');
        
        const priv = await checkParticipantPrivileges(sock, remoteJid, targetJid);
        if (priv.isAdmin) {
            throw new Error(`Aksi ditolak: Target sudah berstatus sebagai Admin.`);
        }

        const actualTarget = priv.actualJid || targetJid;
        console.log(`[LOG ACTION PROMOTE] Mengeksekusi promote ${actualTarget} di ${remoteJid}`);
        await sock.groupParticipantsUpdate(remoteJid, [actualTarget], "promote");
        return `Promote ${actualTarget}`;
    },
    DEMOTE: async (sock, remoteJid, rawParams) => {
        const targetJid = toJid(rawParams);
        if (!targetJid) throw new Error('Target DEMOTE kosong/tidak valid');
        
        const priv = await checkParticipantPrivileges(sock, remoteJid, targetJid);
        if (priv.isSuperAdmin) {
            throw new Error(`Aksi ditolak: Tidak dapat mencabut status admin dari Owner/Creator grup.`);
        }
        if (!priv.isAdmin) {
            throw new Error(`Aksi ditolak: Target bukan merupakan Admin.`);
        }

        const actualTarget = priv.actualJid || targetJid;
        console.log(`[LOG ACTION DEMOTE] Mengeksekusi demote ${actualTarget} di ${remoteJid}`);
        await sock.groupParticipantsUpdate(remoteJid, [actualTarget], "demote");
        return `Demote ${actualTarget}`;
    }
};

module.exports = memberActions;
