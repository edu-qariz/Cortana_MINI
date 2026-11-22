'use strict';

const config = require('./config');
const { fetchJson } = require('./helpers');

const BASE = 'https://knightbotapi.stream';
const API_KEY = process.env.KNIGHTBOT_API_KEY || 'knight';

const AUDIO_EXT = /\.(mp3|m4a|ogg|opus|wav)(\?|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)(\?|$)/i;

let cooldownUntil = 0;

function usableThumb(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value) && !value.includes('******')
        ? value
        : undefined;
}

function directUrl(node) {
    const candidate = node?.download || node?.dl_url || node?.dl || node?.url;
    return typeof candidate === 'string' && /^https?:\/\//i.test(candidate) ? candidate : undefined;
}

function kindFromUrl(url) {
    if (/mime_type=audio/i.test(url) || AUDIO_EXT.test(url)) return 'audio';
    if (/mime_type=video/i.test(url)) return 'video';
    if (IMAGE_EXT.test(url)) return 'image';
    return undefined;
}

function normalizeItem(node) {
    if (typeof node === 'string') {
        return /^https?:\/\//i.test(node) ? { kind: kindFromUrl(node) || 'image', url: node } : null;
    }
    const url = directUrl(node);
    if (!url) return null;
    const declared = String(node?.type || '').toLowerCase();
    const kind = ['video', 'audio', 'image'].includes(declared) ? declared : (kindFromUrl(url) || 'video');
    return { kind, url };
}

function normalizeMedia(result) {
    if (!result || typeof result !== 'object') return null;
    const title = String(result.title || result.query || 'Media');
    const thumbnail = usableThumb(result.thumbnail);
    const duration = result.duration ? String(result.duration) : undefined;
    const primary = directUrl(result);

    let items = [];
    if (Array.isArray(result.media) && result.media.length) {
        items = result.media.map(normalizeItem).filter(Boolean);
    } else {
        const images = Array.isArray(result.images) ? result.images.map(normalizeItem).filter(Boolean) : [];
        const videos = Array.isArray(result.videos) ? result.videos.map(normalizeItem).filter(Boolean) : [];
        const primaryIsAudio = primary ? kindFromUrl(primary) === 'audio' : false;
        const declaredImage = String(result.type || '').toLowerCase() === 'image';
        if (images.length && (declaredImage || primaryIsAudio || !primary)) items = images;
        else if (videos.length) items = videos;
        else if (primary) items = [{ kind: kindFromUrl(primary) || (declaredImage ? 'image' : 'video'), url: primary }];
    }

    const seen = new Set();
    items = items.filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    }).slice(0, 10);

    return items.length ? { title, thumbnail, duration, items } : null;
}

async function knightGet(path, params = {}) {
    if (Date.now() < cooldownUntil) return null;
    const query = new URLSearchParams({ apikey: API_KEY });
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) query.set(key, String(value));
    }
    try {
        const data = await fetchJson(`${BASE}${path}?${query.toString()}`, {}, 45_000);
        if (!data?.success || data.result === undefined || data.result === null) return null;
        return data.result;
    } catch (error) {
        if (/429|timeout|fetch failed/i.test(error.message)) cooldownUntil = Date.now() + 120_000;
        return null;
    }
}

async function knightAudio(url, format = '128kbps') {
    const result = await knightGet('/api/download/ytaudio', { url, format });
    return normalizeMedia(result);
}

async function knightVideo(url, format = '720p') {
    const result = await knightGet('/api/download/ytmp4', { url, format });
    return normalizeMedia(result);
}

async function knightAi(prompt) {
    const result = await knightGet('/api/ai/chat', { q: prompt });
    return typeof result === 'string' && result.trim() ? result.trim() : null;
}

module.exports = {
    BASE,
    API_KEY,
    knightGet,
    knightAudio,
    knightVideo,
    knightAi,
    normalizeMedia,
};
