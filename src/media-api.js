'use strict';

const logger = require('./logger');
const { fetchJson } = require('./helpers');
const { knightAudio, knightVideo } = require('./knight');

function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && /^https?:\/\//i.test(value) && !value.includes('******')) return value;
    }
    return '';
}

function pickDownloadUrl(data) {
    return firstString(
        data?.result?.download_url,
        data?.result?.url,
        data?.result?.mp3,
        data?.result?.mp4,
        data?.result?.download?.url,
        data?.result?.download,
        data?.result?.dl_url,
        data?.result?.dl,
        data?.download_url,
        data?.url,
        data?.link,
        data?.data?.download_url,
        data?.data?.url,
        data?.data?.download?.url
    );
}

function pickThumb(data) {
    return firstString(
        data?.result?.thumbnail,
        data?.result?.thumb,
        data?.result?.image,
        data?.thumbnail,
        data?.thumb,
        data?.data?.thumbnail
    );
}

function pickTitle(data, fallback) {
    return String(
        data?.result?.title ||
        data?.result?.name ||
        data?.title ||
        data?.data?.title ||
        fallback ||
        'YouTube Media'
    );
}

function itemOf(media, kind) {
    if (!media?.items?.length) return null;
    return media.items.find((item) => item.kind === kind) || media.items[0];
}

async function tryEndpoint(url, fallbackTitle) {
    try {
        const data = await fetchJson(url, {}, 30_000);
        const download = pickDownloadUrl(data);
        if (!download) return null;
        return {
            url: download,
            title: pickTitle(data, fallbackTitle),
            thumbnail: pickThumb(data) || undefined,
        };
    } catch (error) {
        logger.debug(`media api failed: ${new URL(url).host} ${error.message}`);
        return null;
    }
}

async function resolveAudio(youtubeUrl) {
    const knight = await knightAudio(youtubeUrl);
    const knightItem = itemOf(knight, 'audio');
    if (knightItem?.url) {
        return {
            url: knightItem.url,
            title: knight.title,
            thumbnail: knight.thumbnail,
            duration: knight.duration,
            source: 'KnightBot',
        };
    }

    const encoded = encodeURIComponent(youtubeUrl);
    const endpoints = [
        `https://api.giftedtech.co.ke/api/download/ytmp3?apikey=gifted&url=${encoded}&quality=128kbps`,
        `https://api.giftedtech.co.ke/api/download/savetubemp3?apikey=gifted&url=${encoded}`,
        `https://api.maher-zubair.tech/download/ytmp3?url=${encoded}`,
        `https://api.vreden.my.id/api/download/ytmp3?url=${encoded}`,
    ];
    for (const endpoint of endpoints) {
        const result = await tryEndpoint(endpoint, 'YouTube Audio');
        if (result) return { ...result, source: new URL(endpoint).host };
    }
    return null;
}

async function resolveVideo(youtubeUrl) {
    const knight = await knightVideo(youtubeUrl);
    const knightItem = itemOf(knight, 'video');
    if (knightItem?.url) {
        return {
            url: knightItem.url,
            title: knight.title,
            thumbnail: knight.thumbnail,
            duration: knight.duration,
            source: 'KnightBot',
        };
    }

    const encoded = encodeURIComponent(youtubeUrl);
    const endpoints = [
        `https://api.giftedtech.co.ke/api/download/ytmp4?apikey=gifted&url=${encoded}&quality=720p`,
        `https://api.giftedtech.co.ke/api/download/savetubemp4?apikey=gifted&url=${encoded}`,
        `https://api.maher-zubair.tech/download/ytmp4?url=${encoded}`,
        `https://api.vreden.my.id/api/download/ytmp4?url=${encoded}`,
    ];
    for (const endpoint of endpoints) {
        const result = await tryEndpoint(endpoint, 'YouTube Video');
        if (result) return { ...result, source: new URL(endpoint).host };
    }
    return null;
}

module.exports = { resolveAudio, resolveVideo };
