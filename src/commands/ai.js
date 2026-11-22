'use strict';

const config = require('../config');
const logger = require('../logger');
const { TTLMap } = require('../cache');
const { sendBranded, sendLoading, editOrSend } = require('../render');
const { register } = require('../registry');
const { usageBox } = require('../helpers');

const memory = new TTLMap({ ttlMs: 20 * 60_000, max: 200, name: 'aiMemory' });

const PROVIDERS = {
    groq: {
        label: 'Groq',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        key: () => config.ai.groqKey,
        model: () => config.ai.groqModel,
    },
    openai: {
        label: 'OpenAI',
        url: 'https://api.openai.com/v1/chat/completions',
        key: () => config.ai.openaiKey,
        model: () => config.ai.openaiModel,
    },
    deepseek: {
        label: 'DeepSeek',
        url: 'https://api.deepseek.com/chat/completions',
        key: () => config.ai.deepseekKey,
        model: () => config.ai.deepseekModel,
    },
};

const PERSONAS = {
    cortana: 'You are Cortana, a sharp, playful WhatsApp assistant. Keep answers concise and useful. Use at most two emojis. Never mention being a language model.',
    deepseek: 'You are DeepSeek inside a WhatsApp bot. Be precise, practical and concise. Use plain text suitable for WhatsApp.',
    chatgpt: 'You are ChatGPT inside a WhatsApp bot. Be helpful, brief and conversational. Use plain text suitable for WhatsApp.',
};

const POLLINATIONS_URL = 'https://text.pollinations.ai/openai';

function resolveProvider(name) {
    if (name === 'deepseek') return config.ai.deepseekKey ? 'deepseek' : 'pollinations';
    if (name === 'chatgpt') return config.ai.openaiKey ? 'openai' : 'pollinations';
    if (config.ai.groqKey) return 'groq';
    if (config.ai.openaiKey) return 'openai';
    if (config.ai.deepseekKey) return 'deepseek';
    return 'pollinations';
}

// Kept for callers: a keyless provider is always available.
function hasAnyKey() {
    return true;
}

async function ask(providerName, prompt, chatId, persona = 'cortana') {
    const memoryKey = `${chatId}:${providerName}`;
    const history = memory.get(memoryKey) || [];
    let answer = '';

    if (providerName === 'pollinations') {
        const system = `${PERSONAS[persona] || PERSONAS.cortana}\nKeep replies to 1-3 short lines unless the user asks for more.`;
        const response = await fetch(POLLINATIONS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'openai',
                messages: [
                    { role: 'system', content: system },
                    ...history.slice(-config.aiMemoryTurns * 2),
                    { role: 'user', content: prompt },
                ],
                temperature: 0.85,
                max_tokens: 900,
            }),
            signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`Pollinations HTTP ${response.status}`);
        const data = await response.json();
        answer = data?.choices?.[0]?.message?.content?.trim() || '';
    } else {
        const provider = PROVIDERS[providerName];
        if (!provider) throw new Error('unknown AI provider');
        const key = provider.key();
        if (!key) throw new Error(`${provider.label} key is not configured`);

        const response = await fetch(provider.url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: provider.model(),
                messages: [
                    { role: 'system', content: PERSONAS[persona] || PERSONAS.cortana },
                    ...history.slice(-config.aiMemoryTurns * 2),
                    { role: 'user', content: prompt },
                ],
                temperature: 0.8,
                max_tokens: 900,
            }),
            signal: AbortSignal.timeout(60_000),
        });

        if (!response.ok) {
            const detail = (await response.text()).slice(0, 300);
            throw new Error(`${provider.label} HTTP ${response.status}: ${detail}`);
        }

        const data = await response.json();
        answer = data?.choices?.[0]?.message?.content?.trim() || '';
    }

    if (!answer) throw new Error('empty AI response');

    const nextHistory = [...history, { role: 'user', content: prompt }, { role: 'assistant', content: answer }]
        .slice(-config.aiMemoryTurns * 2);
    memory.set(memoryKey, nextHistory);
    return answer;
}

function splitAnswer(text, max = 3500) {
    const chunks = [];
    let rest = String(text || '');
    while (rest.length > max) {
        let cut = rest.lastIndexOf('\n', max);
        if (cut < max * 0.5) cut = max;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
    }
    if (rest) chunks.push(rest);
    return chunks;
}

async function runAi(ctx, providerName, persona) {
    const prompt = ctx.text.trim();
    if (!prompt) {
        return ctx.reply(usageBox(ctx.prefix, [`${ctx.prefix}${ctx.command} your question`]));
    }
    if (!hasAnyKey()) {
        logger.warn(`AI unavailable for ${ctx.command}: no provider key configured`);
        return ctx.reply('🧠 *AI IS RESTING*\n\nThis brain is offline right now. Try again later. 😴');
    }
    const provider = resolveProvider(providerName);
    if (!provider) {
        logger.warn(`AI provider unavailable: ${providerName}`);
        return ctx.reply('🧠 *AI IS RESTING*\n\nThis brain is offline right now. Try again later. 😴');
    }
    await ctx.react('🧠');
    await ctx.sock.sendPresenceUpdate('composing', ctx.chat).catch(() => {});
    const loading = await sendLoading(ctx, `${ctx.command} is thinking…`);
    try {
        const answer = await ask(provider, prompt, ctx.chat, persona);
        const chunks = splitAnswer(answer);
        await editOrSend(ctx, loading, chunks[0]);
        for (const chunk of chunks.slice(1)) {
            await sendBranded(ctx, { text: chunk });
        }
        await ctx.react('✅');
    } catch (error) {
        logger.error(`command.${ctx.command}`, error);
        await editOrSend(ctx, loading, '💥 *AI MELTDOWN*\n\nThe brain dropped the thought. Try again.').catch(() => {});
        await ctx.react('❌');
    } finally {
        await ctx.sock.sendPresenceUpdate('paused', ctx.chat).catch(() => {});
    }
}

register({
    name: 'cortana',
    aliases: ['ai', 'ask'],
    category: 'ai',
    description: 'Ask the Cortana AI',
    async execute(ctx) {
        return runAi(ctx, 'cortana', 'cortana');
    },
});

register({
    name: 'deepseek',
    aliases: ['ds'],
    category: 'ai',
    description: 'Ask DeepSeek',
    async execute(ctx) {
        return runAi(ctx, 'deepseek', 'deepseek');
    },
});

register({
    name: 'chatgpt',
    aliases: ['gpt', 'openai'],
    category: 'ai',
    description: 'Ask ChatGPT',
    async execute(ctx) {
        return runAi(ctx, 'chatgpt', 'chatgpt');
    },
});

async function generateReply(chatId, prompt) {
    const provider = resolveProvider('cortana');
    if (!provider) return null;
    return ask(provider, prompt, chatId, 'cortana');
}

module.exports = { generateReply, hasAnyKey };
