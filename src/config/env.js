try {
    require('dotenv').config();
} catch (e) {
    // dotenv opsional jika variabel lingkungan di-inject langsung oleh container/sistem
}

const AI_PROVIDER = (process.env.AI_PROVIDER || "gemini").toLowerCase().trim();
const AI_MODEL = (process.env.AI_MODEL || "").trim();
const AI_API_KEY = (process.env.AI_API_KEY || "").trim();

const ENABLE_SEND_DM = (process.env.ENABLE_SEND_DM || "false").toLowerCase() === "true";
const ENABLE_ADD_MEMBER = (process.env.ENABLE_ADD_MEMBER || "false").toLowerCase() === "true";
const MAX_DESTRUCTIVE_ACTIONS_PER_RUN = parseInt(process.env.MAX_DESTRUCTIVE_ACTIONS_PER_RUN || "10", 10);

// Konfigurasi Autonomous Loop
const LOOP_MAX_OUTER_STEPS = parseInt(process.env.LOOP_MAX_OUTER_STEPS || "5", 10);
const LOOP_MAX_INNER_STEPS = parseInt(process.env.LOOP_MAX_INNER_STEPS || "5", 10);
const LOOP_STEP_TIMEOUT_MS = parseInt(process.env.LOOP_STEP_TIMEOUT_MS || "60000", 10);
const LOOP_BASE_RETRY_DELAY_MS = parseInt(process.env.LOOP_BASE_RETRY_DELAY_MS || "2000", 10);
const LOOP_MAX_LOG_ENTRIES = parseInt(process.env.LOOP_MAX_LOG_ENTRIES || "20", 10);

const PORT = process.env.PORT || 30493;

const OWNER_NUMBER = (process.env.OWNER_NUMBER || "").trim() + "@s.whatsapp.net";
let OWNER_LID = (process.env.OWNER_LID || "").trim();
if (OWNER_LID && !OWNER_LID.includes('@')) {
    OWNER_LID = OWNER_LID + "@lid";
}
const BOT_NUMBER = (process.env.BOT_NUMBER || "").trim();

function validateEnv() {
    console.log('[LOG CONFIG] Memvalidasi environment variables...');
    const missing = [];
    if (!process.env.OWNER_NUMBER) missing.push('OWNER_NUMBER');
    if (AI_PROVIDER === 'gemini' && !(AI_API_KEY || process.env.GEMINI_API_KEY)) missing.push('AI_API_KEY / GEMINI_API_KEY');
    if ((AI_PROVIDER === 'openai' || AI_PROVIDER === 'chatgpt') && !(AI_API_KEY || process.env.OPENAI_API_KEY)) missing.push('AI_API_KEY / OPENAI_API_KEY');
    if ((AI_PROVIDER === 'claude' || AI_PROVIDER === 'anthropic') && !(AI_API_KEY || process.env.ANTHROPIC_API_KEY)) missing.push('AI_API_KEY / ANTHROPIC_API_KEY');
    if (missing.length > 0) {
        console.error(`[FATAL] Environment variable belum diisi: ${missing.join(', ')}. Bot akan tetap berjalan tapi fitur AI pasti gagal sampai ini diisi.`);
    } else {
        console.log('[LOG CONFIG] Validasi environment variables selesai. Aman.');
    }
}

module.exports = {
    AI_PROVIDER,
    AI_MODEL,
    AI_API_KEY,
    ENABLE_SEND_DM,
    ENABLE_ADD_MEMBER,
    MAX_DESTRUCTIVE_ACTIONS_PER_RUN,
    LOOP_MAX_OUTER_STEPS,
    LOOP_MAX_INNER_STEPS,
    LOOP_STEP_TIMEOUT_MS,
    LOOP_BASE_RETRY_DELAY_MS,
    LOOP_MAX_LOG_ENTRIES,
    PORT,
    OWNER_NUMBER,
    OWNER_LID,
    BOT_NUMBER,
    validateEnv
};
