// Sinkronisasi otomatis dari remote repository jika ada konflik lokal
require('./src/utils/gitSync');

const express = require('express');
const { validateEnv, AI_PROVIDER, PORT } = require('./src/config/env');
const { startWhatsAppBot, setupGracefulShutdown } = require('./src/bot/socket');
const log = require('./src/utils/logger');

// Validasi Environment Variables saat aplikasi start
validateEnv();

// Setup graceful shutdown (membersihkan loop aktif saat proses dihentikan)
setupGracefulShutdown();

const app = express();

app.get('/', (req, res) => {
    log.debug('SERVER', 'Menerima HTTP GET request ke endpoint utama');
    res.send(`Server Webhook & Bot WA Aktif! Menggunakan Provider AI: ${AI_PROVIDER.toUpperCase()}`);
});

process.on('unhandledRejection', (reason) => {
    log.fatal('PROCESS', 'Unhandled Rejection detected', reason);
});

process.on('uncaughtException', (err) => {
    log.fatal('PROCESS', 'Uncaught Exception detected', err);
});

app.listen(PORT, () => {
    log.info('SERVER', `Server Express berjalan pada port ${PORT}`);
    startWhatsAppBot();
});