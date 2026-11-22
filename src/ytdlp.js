'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');

let ffmpegPath = '';
try {
    ffmpegPath = require('ffmpeg-static') || '';
} catch { /* ffmpeg is optional for already-muxed formats */ }

function tempPath(extension) {
    return path.join(config.paths.tmp, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extension}`);
}

function loadYtDlp() {
    // Lazy require so a missing optional binary cannot crash the whole bot.
    return require('youtube-dl-exec');
}

async function download(url, extension, options, timeoutMs) {
    const youtubedl = loadYtDlp();
    const output = tempPath(extension);
    try {
        await youtubedl(url, {
            output,
            noWarnings: true,
            noCheckCertificates: true,
            noPlaylist: true,
            ...(ffmpegPath ? { ffmpegLocation: ffmpegPath } : {}),
            ...options,
        }, { timeout: timeoutMs });
        const buffer = fs.readFileSync(output);
        if (buffer.length > config.maxMediaBytes) {
            throw new Error('media is too large');
        }
        return buffer;
    } finally {
        try { fs.rmSync(output, { force: true }); } catch { /* best effort */ }
    }
}

async function downloadAudio(url) {
    logger.debug('yt-dlp audio download');
    return download(url, 'mp3', {
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: 5,
        preferFreeFormats: true,
    }, 180_000);
}

async function downloadVideo(url) {
    logger.debug('yt-dlp video download');
    return download(url, 'mp4', {
        format: 'best[ext=mp4]/best',
        mergeOutputFormat: 'mp4',
    }, 240_000);
}

module.exports = { downloadAudio, downloadVideo };
