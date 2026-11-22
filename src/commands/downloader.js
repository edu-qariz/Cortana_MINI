'use strict';

const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const cheerio = require('cheerio');
const config = require('../config');
const logger = require('../logger');
const mediaTools = require('../media');
const ytdlp = require('../ytdlp');
const { resolveAudio, resolveVideo } = require('../media-api');
const { sendBranded, sendLoading, editOrSend, brandedQuote } = require('../render');
const { register } = require('../registry');
const { usageBox, fetchJson, fetchText, humanBytes, withTimeout } = require('../helpers');

function safeName(title) {
    return String(title || 'media').replace(/[^a-zA-Z0-9\s-]/g, '').trim().slice(0, 80) || 'media';
}

function mediaCard(kind, video) {
    const audio = kind === 'audio';
    return `╔═════════════════════════════╗\n` +
        `║   ${audio ? '🎵' : '🎬'}  *CORTANA PRO MINI*   ║\n` +
        `╠═════════════════════════════╣\n` +
        `║ 📛 *Title:* ${video.title}\n` +
        `║ ⏱️ *Duration:* ${video.timestamp || 'Unknown'}\n` +
        `║ 👤 *Channel:* ${video.author?.name || 'Unknown'}\n` +
        `║ 👁️ *Views:* ${video.views ? video.views.toLocaleString() : 'Unknown'}\n` +
        `╚═════════════════════════════╝\n\n` +
        `> ⬇️ *Downloading ${kind} to your device...*`;
}

async function collectStream(stream, maxBytes, label) {
    const chunks = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
        if (!settled) stream.destroy(new Error(`${label} timed out`));
    }, 120_000);
    try {
        for await (const chunk of stream) {
            size += chunk.length;
            if (size > maxBytes) {
                stream.destroy();
                throw new Error(`${label} is too large (${humanBytes(size)})`);
            }
            chunks.push(chunk);
        }
        settled = true;
        return Buffer.concat(chunks);
    } finally {
        clearTimeout(timer);
    }
}

async function searchOne(query) {
    const result = await yts(query);
    const video = result.videos?.[0];
    if (!video) throw new Error('no result found');
    return video;
}

register({
    name: 'play',
    aliases: ['song', 'ytmp3'],
    category: 'downloader',
    description: 'Download audio from YouTube',
    async execute(ctx) {
        const query = ctx.text.trim();
        if (!query) {
            return ctx.reply(usageBox(ctx.prefix, [`${ctx.prefix}play faded`, `${ctx.prefix}play https://youtu.be/…`]));
        }
        await ctx.react('⏳');
        const loading = await sendLoading(ctx, 'Searching YouTube for audio…');
        try {
            const video = await searchOne(query);
            await editOrSend(ctx, loading, '✅ *Found — sending details…*');
            const card = mediaCard('audio', video);
            if (video.thumbnail) {
                await sendBranded(ctx, { image: { url: video.thumbnail }, caption: card });
            } else {
                await sendBranded(ctx, { text: card });
            }

            let mp3 = null;
            try {
                mp3 = await ytdlp.downloadAudio(video.url);
            } catch (error) {
                logger.warn(`yt-dlp audio failed: ${error.message}`);
            }
            if (!mp3) {
                const resolved = await resolveAudio(video.url);
                if (resolved?.url) {
                    await ctx.send({
                        audio: { url: resolved.url },
                        mimetype: 'audio/mpeg',
                        fileName: `${safeName(video.title)}.mp3`,
                        ptt: false,
                    }, { quoted: brandedQuote() });
                    await ctx.react('✅');
                    return;
                }
            }
            if (!mp3) {
                const stream = ytdl(video.url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
                const raw = await collectStream(stream, config.maxMediaBytes, 'audio');
                mp3 = await mediaTools.toMp3(raw);
            }
            await ctx.send({
                audio: mp3,
                mimetype: 'audio/mpeg',
                fileName: `${safeName(video.title)}.mp3`,
                ptt: false,
            }, { quoted: brandedQuote() });
            await ctx.react('✅');
        } catch (error) {
            logger.error('command.play', error);
            await ctx.reply('❌ *AUDIO FAILED*\n\nThat track refused to download. Try another query or link.').catch(() => {});
            await ctx.react('❌');
        }
    },
});

register({
    name: 'video',
    aliases: ['ytmp4', 'vid'],
    category: 'downloader',
    description: 'Download video from YouTube',
    async execute(ctx) {
        const query = ctx.text.trim();
        if (!query) {
            return ctx.reply(usageBox(ctx.prefix, [`${ctx.prefix}video faded`, `${ctx.prefix}video https://youtu.be/…`]));
        }
        await ctx.react('⏳');
        const loading = await sendLoading(ctx, 'Searching YouTube for video…');
        try {
            const video = await searchOne(query);
            await editOrSend(ctx, loading, '✅ *Found — sending details…*');
            const card = mediaCard('video', video);
            if (video.thumbnail) {
                await sendBranded(ctx, { image: { url: video.thumbnail }, caption: card });
            } else {
                await sendBranded(ctx, { text: card });
            }

            let buffer = null;
            try {
                buffer = await ytdlp.downloadVideo(video.url);
            } catch (error) {
                logger.warn(`yt-dlp video failed: ${error.message}`);
            }
            if (!buffer) {
                const resolved = await resolveVideo(video.url);
                if (resolved?.url) {
                    await ctx.send({
                        video: { url: resolved.url },
                        mimetype: 'video/mp4',
                        fileName: `${safeName(video.title)}.mp4`,
                        caption: `🎬 *${video.title}*\n\n> Downloaded via CORTANA PRO MINI`,
                    }, { quoted: brandedQuote() });
                    await ctx.react('✅');
                    return;
                }
            }
            if (!buffer) {
                try {
                    const stream = ytdl(video.url, { filter: 'audioandvideo', quality: '18', highWaterMark: 1 << 25 });
                    buffer = await collectStream(stream, config.maxMediaBytes, 'video');
                } catch {
                    const fallback = ytdl(video.url, { filter: 'audioandvideo', quality: 'lowest', highWaterMark: 1 << 25 });
                    buffer = await collectStream(fallback, config.maxMediaBytes, 'video');
                }
            }
            await ctx.send({
                video: buffer,
                mimetype: 'video/mp4',
                caption: `🎬 *${video.title}*\n\n📦 ${humanBytes(buffer.length)}\n\n> Downloaded via CORTANA PRO MINI`,
            }, { quoted: brandedQuote() });
            await ctx.react('✅');
        } catch (error) {
            logger.error('command.video', error);
            await ctx.reply('❌ *VIDEO FAILED*\n\nThat video refused to download. Try another link.').catch(() => {});
            await ctx.react('❌');
        }
    },
});

register({
    name: 'waifu',
    aliases: ['animepic'],
    category: 'downloader',
    description: 'Random anime waifu image',
    async execute(ctx) {
        try {
            const data = await withTimeout(fetchJson('https://api.waifu.pics/sfw/waifu'), 15_000, 'waifu');
            return sendBranded(ctx, { image: { url: data.url }, caption: '🌸 *fresh waifu delivered*' });
        } catch (error) {
            logger.error('command.waifu', error);
            return ctx.reply('❌ The waifu collection is hiding. Try again.');
        }
    },
});

register({
    name: 'lyrics',
    aliases: ['lyric'],
    category: 'downloader',
    description: 'Fetch song lyrics',
    async execute(ctx) {
        const query = ctx.text.trim();
        if (!query) return ctx.reply(usageBox(ctx.prefix, [`${ctx.prefix}lyrics faded alan walker`]));
        await ctx.react('🎵');
        const loading = await sendLoading(ctx, `Searching lyrics for *${query}*…`);
        try {
            const data = await withTimeout(
                fetchJson(`https://lyrist.vercel.app/api/${encodeURIComponent(query)}`),
                15_000,
                'lyrics'
            );
            if (!data?.lyrics) throw new Error('no lyrics found');
            const body = String(data.lyrics).slice(0, 4000);
            return editOrSend(ctx, loading, `🎵 *${data.title || query}* — ${data.artist || 'unknown'}\n\n${body}`);
        } catch (error) {
            logger.error('command.lyrics', error);
            return editOrSend(ctx, loading, '❌ *NO LYRICS*\n\nI could not find that song. Try artist - title.');
        }
    },
});

register({
    name: 'apk',
    aliases: ['playstore', 'appsearch'],
    category: 'downloader',
    description: 'Search Google Play for apps',
    async execute(ctx) {
        const query = ctx.text.trim();
        if (!query) return ctx.reply(usageBox(ctx.prefix, [`${ctx.prefix}apk whatsapp`]));
        await ctx.react('📱');
        const loading = await sendLoading(ctx, `Searching Play Store for *${query}*…`);
        try {
            const html = await withTimeout(
                fetchText(`https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=en&gl=US`),
                20_000,
                'play store'
            );
            const $ = cheerio.load(html);
            const seen = new Set();
            const results = [];
            $('a[href*="/store/apps/details?id="]').each((_, element) => {
                const href = $(element).attr('href') || '';
                const idMatch = href.match(/id=([A-Za-z0-9._]+)/);
                if (!idMatch || seen.has(idMatch[1])) return;
                seen.add(idMatch[1]);
                const name = $(element).text().replace(/\s+/g, ' ').trim() || idMatch[1];
                results.push({ name: name.slice(0, 60), id: idMatch[1] });
            });
            if (!results.length) throw new Error('no apps found');
            const lines = results.slice(0, 6).map((app, index) =>
                `${index + 1}. *${app.name}*\n   https://play.google.com/store/apps/details?id=${app.id}`
            );
            return editOrSend(
                ctx,
                loading,
                `🔎 *PLAY STORE — ${query}*\n\n${lines.join('\n\n')}`
            );
        } catch (error) {
            logger.error('command.apk', error);
            return editOrSend(ctx, loading, '❌ Play Store is not answering. Try again.');
        }
    },
});
