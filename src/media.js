'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const config = require('./config');

function tempPath(extension) {
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extension}`;
    return path.join(config.paths.tmp, name);
}

function runFfmpeg(args, timeoutMs = 90_000) {
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, args, { windowsHide: true });
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('media conversion timed out'));
        }, timeoutMs);
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 8000) stderr = stderr.slice(-8000);
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited with ${code}: ${stderr.split('\n').slice(-3).join(' ')}`));
        });
    });
}

async function withTempFiles(jobs, fn) {
    const created = [];
    try {
        return await fn(jobs);
    } finally {
        for (const file of created) {
            try { fs.rmSync(file, { force: true }); } catch { /* best effort */ }
        }
    }
}

async function toSticker(buffer) {
    const input = tempPath('input');
    const output = tempPath('webp');
    fs.writeFileSync(input, buffer);
    try {
        await runFfmpeg([
            '-y', '-i', input,
            '-t', '6',
            '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
            '-c:v', 'libwebp', '-lossless', '0', '-q:v', '72',
            '-preset', 'default', '-an', '-vsync', '0',
            output,
        ]);
        return fs.readFileSync(output);
    } finally {
        fs.rmSync(input, { force: true });
        fs.rmSync(output, { force: true });
    }
}

async function toImage(buffer) {
    const input = tempPath('input');
    const output = tempPath('png');
    fs.writeFileSync(input, buffer);
    try {
        await runFfmpeg(['-y', '-i', input, '-frames:v', '1', output]);
        return fs.readFileSync(output);
    } finally {
        fs.rmSync(input, { force: true });
        fs.rmSync(output, { force: true });
    }
}

async function toMp3(buffer) {
    const input = tempPath('input');
    const output = tempPath('mp3');
    fs.writeFileSync(input, buffer);
    try {
        await runFfmpeg(['-y', '-i', input, '-vn', '-c:a', 'libmp3lame', '-q:a', '4', output]);
        return fs.readFileSync(output);
    } finally {
        fs.rmSync(input, { force: true });
        fs.rmSync(output, { force: true });
    }
}

async function changeTempo(buffer, rate) {
    const input = tempPath('input');
    const output = tempPath('mp3');
    fs.writeFileSync(input, buffer);
    const clamped = Math.min(2, Math.max(0.5, rate));
    try {
        await runFfmpeg(['-y', '-i', input, '-filter:a', `atempo=${clamped}`, '-vn', '-c:a', 'libmp3lame', '-q:a', '4', output]);
        return fs.readFileSync(output);
    } finally {
        fs.rmSync(input, { force: true });
        fs.rmSync(output, { force: true });
    }
}

async function uploadCatbox(buffer, filename = 'cortana-mini.bin') {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([buffer]), filename);
    const response = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60_000),
    });
    const text = (await response.text()).trim();
    if (!response.ok || !/^https:\/\//i.test(text)) throw new Error(text || 'upload rejected');
    return text;
}

function cleanupTmp(maxAgeMs = 15 * 60_000) {
    try {
        const now = Date.now();
        for (const entry of fs.readdirSync(config.paths.tmp)) {
            const file = path.join(config.paths.tmp, entry);
            try {
                const stat = fs.statSync(file);
                if (now - stat.mtimeMs > maxAgeMs) fs.rmSync(file, { force: true });
            } catch { /* file may disappear mid-scan */ }
        }
    } catch { /* tmp cleanup is best effort */ }
}

module.exports = {
    tempPath,
    runFfmpeg,
    toSticker,
    toImage,
    toMp3,
    changeTempo,
    uploadCatbox,
    cleanupTmp,
};
