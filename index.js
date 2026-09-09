const express = require('express');
const { validateEnv, AI_PROVIDER, PORT } = require('./src/config/env');
const { startWhatsAppBot } = require('./src/bot/socket');

// Validasi Environment Variables saat aplikasi start
validateEnv();

const app = express();

app.get('/', (req, res) => {
    console.log('[LOG SERVER] Menerima HTTP GET request ke endpoint utama.');
    res.send(`Server Webhook & Bot WA Aktif! Menggunakan Provider AI: ${AI_PROVIDER.toUpperCase()}`);
});

process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION DETECTED]:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION DETECTED]:', err);
});

app.listen(PORT, () => {
    console.log(`[LOG SERVER] Server Express berjalan pada port ${PORT}`);
    startWhatsAppBot();
});