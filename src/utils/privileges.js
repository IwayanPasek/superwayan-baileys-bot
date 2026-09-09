async function checkParticipantPrivileges(sock, remoteJid, targetJid, groupMetaCache = null) {
    try {
        console.log(`[LOG PRIVILEGES] Memeriksa hak akses untuk target: ${targetJid} di grup: ${remoteJid}`);
        const metadata = groupMetaCache || await sock.groupMetadata(remoteJid);
        const participants = metadata.participants || [];

        const targetClean = (targetJid || '').trim();
        const targetNumber = targetClean.replace(/[^0-9]/g, '');

        const targetObj = participants.find(p => {
            const pId = p.id || '';
            const pLid = p.lid || '';
            const pNumber = pId.replace(/[^0-9]/g, '');
            const pLidNumber = pLid.replace(/[^0-9]/g, '');

            return (
                pId === targetClean ||
                pLid === targetClean ||
                (targetNumber && pNumber === targetNumber) ||
                (targetNumber && pLidNumber === targetNumber)
            );
        });

        if (!targetObj) {
            console.log(`[LOG PRIVILEGES] Target ${targetJid} (Nomor: ${targetNumber}) tidak ditemukan dalam daftar partisipan.`);
            return { exists: false, isAdmin: false, isSuperAdmin: false, actualJid: null };
        }

        const isAdmin = targetObj.admin === 'admin' || targetObj.admin === 'superadmin';
        const isSuperAdmin = targetObj.admin === 'superadmin' || targetObj.id === metadata.owner;

        console.log(`[LOG PRIVILEGES] Hasil cek -> Target ditemukan: ${targetObj.id}, Admin: ${isAdmin}, SuperAdmin/Owner: ${isSuperAdmin}`);
        return { exists: true, isAdmin, isSuperAdmin, actualJid: targetObj.id };
    } catch (e) {
        console.error(`[LOG PRIVILEGES ERROR] Gagal memeriksa metadata grup:`, e.message);
        return { exists: true, isAdmin: false, isSuperAdmin: false, actualJid: targetJid };
    }
}

module.exports = {
    checkParticipantPrivileges
};
