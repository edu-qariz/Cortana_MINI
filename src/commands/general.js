'use strict';

const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');
const mediaTools = require('../media');
const { fetchWorldNews, fetchTechNews, formatPublished } = require('../news');
const { sendBranded, sendLoading, editOrSend, newsCaption, brandContext } = require('../render');
const { register } = require('../registry');
const {
    downloadFrom,
    mentionedJids,
    resolveTarget,
    jidNumber,
    pick,
    fetchJson,
    usageBox,
} = require('../helpers');

const ADVICE = [
    'Drink water before you argue with someone online. 💧',
    'A tiny step today beats a perfect plan that never starts. 🚶',
    'If it costs your peace, it is too expensive. 🧘',
    'You cannot heal in the same environment that broke you. 🌱',
    'Silence is a valid answer. 🤫',
    'Money loves patience more than hype. 💰',
    'Sleep is a performance-enhancing drug. 😴',
    'The best revenge is a boring, peaceful life. 🕊️',
    'Do not confuse motion with progress. 🧭',
    'Ask for help earlier than your ego wants. 🤝',
    'Protect your attention like it is your wallet. 👀',
    'You are allowed to outgrow people. 🌤️',
];

register({
    name: 'advise',
    aliases: ['advice'],
    category: 'general',
    description: 'Random life advice',
    async execute(ctx) {
        return sendBranded(ctx, { text: `💡 *CORTANA SAYS*\n\n${pick(ADVICE)}` });
    },
});

async function sendNewsDigest(ctx, { emoji, heading, articles }) {
    if (!articles.length) return ctx.reply('❌ No stories available right now.');
    const lead = { ...articles[0], publishedAt: formatPublished(articles[0].publishedAt) };
    const rest = articles.slice(1, 5)
        .map((article, index) => `${index + 2}. ${article.title}\n${article.url}`)
        .join('\n\n');
    const extra = rest ? `📌 *More headlines*\n\n${rest}` : '';
    const caption = `${emoji} *${heading}*\n\n${newsCaption(lead, extra)}`.slice(0, 4000);
    const content = lead.image ? { image: { url: lead.image }, caption } : { text: caption };
    try {
        await sendBranded(ctx, content);
    } catch (error) {
        logger.warn(`news image failed: ${error.message}`);
        await ctx.reply(caption);
    }
}

register({
    name: 'technews',
    aliases: ['tech', 'tnews'],
    category: 'general',
    description: 'Latest technology news with pictures',
    async execute(ctx) {
        await ctx.react('📰');
        const loading = await sendLoading(ctx, 'Fetching the latest technology news…');
        try {
            const articles = await fetchTechNews(5);
            if (!articles.length) throw new Error('no stories available');
            await editOrSend(ctx, loading, `📰 *Tech news* · ${articles.length} stories`);
            await sendNewsDigest(ctx, { emoji: '📰', heading: 'TECH NEWS', articles });
        } catch (error) {
            logger.error('command.technews', error);
            await editOrSend(ctx, loading, '❌ The tech desk is offline. Try again in a moment.');
        }
    },
});

register({
    name: 'trending',
    aliases: ['worldnews', 'breaking'],
    category: 'general',
    description: 'Worldwide trending and breaking news with pictures',
    async execute(ctx) {
        await ctx.react('🌍');
        const loading = await sendLoading(ctx, 'Fetching worldwide breaking news…');
        try {
            const articles = await fetchWorldNews(5);
            if (!articles.length) throw new Error('no stories available');
            await editOrSend(ctx, loading, `🌍 *World trending* · ${articles.length} stories`);
            await sendNewsDigest(ctx, { emoji: '🌍', heading: 'WORLD TRENDING', articles });
        } catch (error) {
            logger.error('command.trending', error);
            await editOrSend(ctx, loading, '❌ The news desk is offline. Try again in a moment.');
        }
    },
});

async function speak(ctx, voice, instruction) {
    const text = ctx.text.trim();
    if (!text) {
        return ctx.reply(usageBox(ctx.prefix, [`${ctx.prefix}${ctx.command} text to speak`]));
    }
    if (!config.ai.openaiKey) {
        logger.warn(`TTS unavailable for ${ctx.command}: OPENAI_API_KEY not configured`);
        return ctx.reply('🎙️ *VOICE ENGINE OFFLINE*\n\nThe voice box is not connected right now. Try again later.');
    }
    await ctx.react('🎙️');
    try {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.ai.openaiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini-tts',
                voice,
                input: instruction ? `${instruction}\n\n${text}` : text,
            }),
            signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        await sendBranded(ctx, { audio: buffer, mimetype: 'audio/mpeg', ptt: false, contextInfo: brandContext() });
        await ctx.react('✅');
    } catch (error) {
        logger.error(`command.${ctx.command}`, error);
        await ctx.react('❌');
        return ctx.reply('💥 *VOICE FAILED*\n\nThe voice engine dropped the line. Try again.');
    }
}

register({
    name: 'talknow',
    aliases: ['tts', 'say'],
    category: 'general',
    description: 'Convert text to speech',
    async execute(ctx) {
        return speak(ctx, 'alloy', '');
    },
});

register({
    name: 'robot',
    aliases: ['robotvoice'],
    category: 'general',
    description: 'Speak text with a robotic voice',
    async execute(ctx) {
        return speak(ctx, 'onyx', 'Speak in a cold, robotic, slightly menacing tone.');
    },
});

register({
    name: 'kiss',
    aliases: ['kisss'],
    category: 'general',
    description: 'Send a kiss reaction image',
    async execute(ctx) {
        const target = resolveTarget(ctx.msg, ctx.chat, ctx.text, mentionedJids(ctx.msg.message));
        try {
            const data = await fetchJson('https://api.waifu.pics/sfw/kiss', {}, 15_000);
            const who = target ? `@${jidNumber(target)}` : 'you';
            return sendBranded(ctx, {
                image: { url: data.url },
                caption: `💋 *smoooch* — ${who} just got kissed.`,
                mentions: target ? [target] : [],
            });
        } catch (error) {
            logger.error('command.kiss', error);
            return ctx.reply('❌ The kiss did not land. Try again.');
        }
    },
});

register({
    name: 'gaycheck',
    aliases: ['gaymeter'],
    category: 'general',
    description: 'Totally fake rainbow scanner',
    async execute(ctx) {
        const target = resolveTarget(ctx.msg, ctx.chat, ctx.text, mentionedJids(ctx.msg.message)) || ctx.sender;
        const digest = crypto.createHash('sha256').update(`${target}:cortana-mini`).digest();
        const score = 12 + (digest[0] % 89);
        const labels = [
            'straight but suspiciously curious 👀',
            'mildly fruity 🍓',
            'rainbow certified 🌈',
            'hetero with premium gay DLC 🎮',
            'chaotic bisexual energy ⚡',
            'straight-ish, pending review 📋',
        ];
        const label = labels[digest[1] % labels.length];
        const bars = Math.round(score / 10);
        const meter = '█'.repeat(bars) + '░'.repeat(10 - bars);
        await ctx.react('🌈');
        return sendBranded(ctx, { text:
            `🌈 *GAYCHECK 3000*\n\n` +
            `🎯 target: @${jidNumber(target)}\n` +
            `📡 scan: [${meter}] ${score}%\n` +
            `🧪 verdict: *${label}*\n\n` +
            '_accuracy: 0.00% · this is a joke, not a diagnosis_ 😹'
        });
    },
});

async function tempo(ctx, rate, label) {
    try {
        const media = await downloadFrom(ctx.sock, ctx.msg, ctx.chat, true);
        if (!media || media.kind !== 'audio') {
            return ctx.reply(usageBox(ctx.prefix, [
                `reply to a voice note or audio with ${ctx.prefix}${ctx.command}`,
                `${ctx.prefix}${ctx.command} makes it ${label}`,
            ]));
        }
        await ctx.react('🎛️');
        const output = await mediaTools.changeTempo(media.buffer, rate);
        await sendBranded(ctx, { audio: output, mimetype: 'audio/mpeg', ptt: false, contextInfo: brandContext() });
        await ctx.react('✅');
    } catch (error) {
        logger.error(`command.${ctx.command}`, error);
        await ctx.react('❌');
        return ctx.reply('❌ That audio could not be processed. Try another clip.');
    }
}

register({
    name: 'fast',
    aliases: ['speedup'],
    category: 'general',
    description: 'Speed up replied audio',
    async execute(ctx) {
        return tempo(ctx, 1.5, 'faster');
    },
});

register({
    name: 'slow',
    aliases: ['slowdown'],
    category: 'general',
    description: 'Slow down replied audio',
    async execute(ctx) {
        return tempo(ctx, 0.75, 'slower');
    },
});
