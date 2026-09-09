const groupActions = {
    SETNAME: async (sock, remoteJid, rawParams) => {
        const newName = (rawParams || '').trim();
        if (!newName) throw new Error('Nama baru kosong');
        console.log(`[LOG ACTION SETNAME] Mengubah subjek grup ${remoteJid} menjadi: "${newName}"`);
        await sock.groupUpdateSubject(remoteJid, newName);
        return `Nama grup diubah menjadi "${newName}"`;
    },
    SETDESC: async (sock, remoteJid, rawParams) => {
        const newDesc = (rawParams || '').trim();
        console.log(`[LOG ACTION SETDESC] Memperbarui deskripsi grup ${remoteJid}`);
        await sock.groupUpdateDescription(remoteJid, newDesc);
        return `Deskripsi grup diperbarui`;
    },
    OPEN_GROUP: async (sock, remoteJid) => {
        console.log(`[LOG ACTION OPEN_GROUP] Membuka pengaturan grup ${remoteJid}`);
        await sock.groupSettingUpdate(remoteJid, 'not_announcement');
        return `Grup dibuka`;
    },
    CLOSE_GROUP: async (sock, remoteJid) => {
        console.log(`[LOG ACTION CLOSE_GROUP] Menutup pengaturan grup ${remoteJid}`);
        await sock.groupSettingUpdate(remoteJid, 'announcement');
        return `Grup ditutup`;
    },
    LINK: async (sock, remoteJid) => {
        console.log(`[LOG ACTION LINK] Mengambil tautan undangan untuk grup ${remoteJid}`);
        const code = await sock.groupInviteCode(remoteJid);
        await sock.sendMessage(remoteJid, { text: `Tautan Undangan Grup:\nhttps://chat.whatsapp.com/${code}` });
        return `Tautan grup dikirim`;
    },
    LEAVE_GROUP: async (sock, remoteJid) => {
        console.log(`[LOG ACTION LEAVE] Bot keluar dari grup ${remoteJid}`);
        await sock.groupLeave(remoteJid);
        return `Keluar dari grup`;
    }
};

module.exports = groupActions;
