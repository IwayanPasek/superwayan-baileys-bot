/**
 * Structured Logger — menggantikan console.log mentah dengan format yang konsisten.
 * 
 * Format: [TIMESTAMP] [LEVEL] [TAG] Pesan
 * Level: DEBUG, INFO, WARN, ERROR, FATAL
 * 
 * Penggunaan:
 *   const log = require('./logger');
 *   log.info('BOT', 'Bot berhasil terhubung');
 *   log.error('AI', 'Gagal memanggil AI', err);
 */

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };

// Baca level dari env, default INFO (production-friendly)
const CURRENT_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] ?? LOG_LEVELS.INFO;

function timestamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatMessage(level, tag, message, extra) {
    const prefix = `[${timestamp()}] [${level}] [${tag}]`;
    if (extra instanceof Error) {
        return `${prefix} ${message}: ${extra.message}`;
    }
    if (extra !== undefined) {
        return `${prefix} ${message} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
    }
    return `${prefix} ${message}`;
}

const logger = {
    debug(tag, message, extra) {
        if (CURRENT_LEVEL <= LOG_LEVELS.DEBUG) {
            console.log(formatMessage('DEBUG', tag, message, extra));
        }
    },
    info(tag, message, extra) {
        if (CURRENT_LEVEL <= LOG_LEVELS.INFO) {
            console.log(formatMessage('INFO', tag, message, extra));
        }
    },
    warn(tag, message, extra) {
        if (CURRENT_LEVEL <= LOG_LEVELS.WARN) {
            console.warn(formatMessage('WARN', tag, message, extra));
        }
    },
    error(tag, message, extra) {
        if (CURRENT_LEVEL <= LOG_LEVELS.ERROR) {
            console.error(formatMessage('ERROR', tag, message, extra));
        }
    },
    fatal(tag, message, extra) {
        console.error(formatMessage('FATAL', tag, message, extra));
    }
};

module.exports = logger;
