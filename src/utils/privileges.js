async function checkParticipantPrivileges(sock, remoteJid, targetJid, groupMetaCache = null) {
    try {
        console.log(`[LOG PRIVILEGES] Memeriksa hak akses untuk target: ${targetJid} di grup: ${remoteJid}`);
        const metadata = groupMetaCache || await sock.groupMetadata(remoteJid);
        const participants = metadata.participants || [];
        const targetObj = participants.find(p => p.id === targetJid);

        if (!targetObj) {
            console.log(`[LOG PRIVILEGES] Target ${targetJid} tidak ditemukan dalam daftar partisipan.`);
            return { exists: false, isAdmin: false, isSuperAdmin: false };
        }

        const isAdmin = targetObj.admin === 'admin' || targetObj.admin === 'superadmin';
        const isSuperAdmin = targetObj.admin === 'superadmin' || targetJid === metadata.owner;

        console.log(`[LOG PRIVILEGES] Hasil cek -> Admin: ${isAdmin}, SuperAdmin/Owner: ${isSuperAdmin}`);
        return { exists: true, isAdmin, isSuperAdmin };
    } catch (e) {
        console.error(`[LOG PRIVILEGES ERROR] Gagal memeriksa metadata grup:`, e.message);
        return { exists: true, isAdmin: false, isSuperAdmin: false };
    }
}

module.exports = {
    checkParticipantPrivileges
};
