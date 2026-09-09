const { GoogleGenAI } = require('@google/genai');
const OpenAI = require('openai');
const { Anthropic } = require('@anthropic-ai/sdk');
const { AI_PROVIDER, AI_MODEL, AI_API_KEY } = require('../config/env');
const { systemInstructionText } = require('../config/prompt');

console.log(`[LOG AI] Menginisialisasi provider AI: ${AI_PROVIDER.toUpperCase()}`);

let geminiClient = null;
let openaiClient = null;
let anthropicClient = null;

if (AI_PROVIDER === "gemini") {
    geminiClient = new GoogleGenAI({ apiKey: AI_API_KEY || process.env.GEMINI_API_KEY });
} else if (AI_PROVIDER === "openai" || AI_PROVIDER === "chatgpt") {
    openaiClient = new OpenAI({ apiKey: AI_API_KEY || process.env.OPENAI_API_KEY });
} else if (AI_PROVIDER === "claude" || AI_PROVIDER === "anthropic") {
    anthropicClient = new Anthropic({ apiKey: AI_API_KEY || process.env.ANTHROPIC_API_KEY });
}

async function generateWithRetry(promptText, maxDemandRetries = 30, delayMs = 5000) {
    let attempt = 1;
    while (attempt <= maxDemandRetries) {
        try {
            console.log(`[LOG AI CALL] Memulai panggilan API AI (${AI_PROVIDER}), percobaan ke-${attempt}/${maxDemandRetries}`);
            const aiCallPromise = (async () => {
                if (AI_PROVIDER === "gemini") {
                    const result = await geminiClient.models.generateContent({
                        model: AI_MODEL || "gemini-2.5-flash",
                        contents: promptText,
                        config: { systemInstruction: systemInstructionText }
                    });
                    return result.text;
                } else if (AI_PROVIDER === "openai" || AI_PROVIDER === "chatgpt") {
                    const completion = await openaiClient.chat.completions.create({
                        model: AI_MODEL || "gpt-4o-mini",
                        messages: [
                            { role: "system", content: systemInstructionText },
                            { role: "user", content: promptText }
                        ]
                    });
                    return completion.choices[0].message.content;
                } else if (AI_PROVIDER === "claude" || AI_PROVIDER === "anthropic") {
                    const message = await anthropicClient.messages.create({
                        model: AI_MODEL || "claude-sonnet-5",
                        max_tokens: 1024,
                        system: systemInstructionText,
                        messages: [{ role: "user", content: promptText }]
                    });
                    return message.content[0].text;
                } else {
                    throw new Error("PROVIDER_AI_TIDAK_DIDUKUNG");
                }
            })();

            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("AI_TIMEOUT_EXCEEDED")), 25000)
            );

            const resText = await Promise.race([aiCallPromise, timeoutPromise]);
            console.log(`[LOG AI SUCCESS] Panggilan AI berhasil merespons pada percobaan ke-${attempt}`);
            return resText;
        } catch (error) {
            const errStr = (error.message || "").toLowerCase();
            const isLimitError =
                errStr.includes("429") ||
                errStr.includes("quota") ||
                errStr.includes("rate") ||
                errStr.includes("high demand") ||
                errStr.includes("overloaded") ||
                errStr.includes("resource_exhausted") ||
                errStr.includes("503") ||
                errStr.includes("ai_timeout_exceeded");

            if (isLimitError) {
                console.warn(`[LOG AI WARNING] Batasan/Timeout terdeteksi pada provider ${AI_PROVIDER} (Percobaan ${attempt}/${maxDemandRetries}): ${error.message}. Menunggu ${delayMs}ms...`);
                if (attempt >= maxDemandRetries) {
                    console.error(`[LOG AI ERROR] Batas maksimum percobaan AI (${maxDemandRetries}) terlampaui.`);
                    throw new Error("AI_MAX_LIMIT_REACHED");
                }
                await new Promise(resolve => setTimeout(resolve, delayMs));
                attempt++;
            } else {
                console.error(`[LOG AI ERROR FATAL] Error tak terduga pada panggilan AI:`, error.message);
                throw error;
            }
        }
    }
    throw new Error("AI_MAX_LIMIT_REACHED");
}

module.exports = {
    geminiClient,
    openaiClient,
    anthropicClient,
    generateWithRetry
};
