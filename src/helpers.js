'use strict';

const crypto = require('crypto');
const pino = require('pino');
const {
    downloadMediaMessage,
    downloadContentFromMessage,
    getContentType,
    normalizeMessageContent,
    jidNormalizedUser,
    generateWAMessageContent,
    generateWAMessageFromContent,
} = require('@whiskeysockets/baileys');
const config = require('./config');

const silentLogger = pino({ level: 'silent' });

const MEDIA_KINDS = {
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    stickerMessage: 'sticker',
    documentMessage: 'document',
};

function unwrap(message) {
    let node = message;
    for (let i = 0; i < 6 && node; i += 1) {
        if (node.ephemeralMessage?.message) { node = node.ephemeralMessage.message; continue; }
        if (node.viewOnceMessage?.message) { node = node.viewOnceMessage.message; continue; }
        if (node.viewOnceMessageV2?.message) { node = node.viewOnceMessageV2.message; continue; }
        if (node.viewOnceMessageV2Extension?.message) { node = node.viewOnceMessageV2Extension.message; continue; }
        if (node.deviceSentMessage?.message) { node = node.deviceSentMessage.message; continue; }
        if (node.documentWithCaptionMessage?.message) { node = node.documentWithCaptionMessage.message; continue; }
        if (node.groupStatusMentionMessage?.message) { node = node.groupStatusMentionMessage.message; continue; }
        break;
    }
    return node;
}

/**
 * View-once detection. WhatsApp strips the envelope when the message arrives as a
 * reply quote: the context carries a bare imageMessage/videoMessage/audioMessage with
 * `viewOnce: true` instead of a viewOnceMessageV2 wrapper. Check both shapes.
 */
function isViewOnce(message) {
    if (!message) return false;
    if (message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension) return true;

    const node = unwrap(normalizeMessageContent(message));
    if (!node) return false;
    if (node.viewOnceMessage || node.viewOnceMessageV2 || node.viewOnceMessageV2Extension) return true;

    for (const key of Object.keys(MEDIA_KINDS)) {
        const media = node[key];
        if (media && (media.viewOnce === true || media.viewOnce === 1)) return true;
    }
    return false;
}

function extractText(message) {
    const node = unwrap(normalizeMessageContent(message));
    if (!node) return '';
    if (typeof node.conversation === 'string') return node.conversation;
    if (node.extendedTextMessage?.text) return node.extendedTextMessage.text;
    if (node.imageMessage?.caption) return node.imageMessage.caption;
    if (node.videoMessage?.caption) return node.videoMessage.caption;
    if (node.documentMessage?.caption) return node.documentMessage.caption;
    if (node.buttonsResponseMessage?.selectedButtonId) return node.buttonsResponseMessage.selectedButtonId;
    if (node.listResponseMessage?.singleSelectReply?.selectedRowId) return node.listResponseMessage.singleSelectReply.selectedRowId;
    if (node.templateButtonReplyMessage?.selectedId) return node.templateButtonReplyMessage.selectedId;
    if (node.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
        try {
            return JSON.parse(node.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson).id || '';
        } catch {
            return '';
        }
    }
    return '';
}

function contextInfoOf(message) {
    const node = unwrap(normalizeMessageContent(message));
    if (!node) return null;
    return node.extendedTextMessage?.contextInfo ||
        node.imageMessage?.contextInfo ||
        node.videoMessage?.contextInfo ||
        node.audioMessage?.contextInfo ||
        node.stickerMessage?.contextInfo ||
        node.documentMessage?.contextInfo ||
        null;
}

function quotedOf(message, chat) {
    const info = contextInfoOf(message);
    if (!info?.quotedMessage) return null;
    return {
        message: info.quotedMessage,
        key: {
            remoteJid: chat,
            id: info.stanzaId,
            participant: info.participant,
            fromMe: false,
        },
    };
}

function findMedia(message) {
    const node = unwrap(normalizeMessageContent(message));
    if (!node) return null;
    for (const [key, kind] of Object.entries(MEDIA_KINDS)) {
        if (node[key]) return { kind, node: node[key], key };
    }
    return null;
}

function messageType(message) {
    const node = unwrap(normalizeMessageContent(message));
    return (node && getContentType(node)) || 'unknown';
}

function mediaCaption(media) {
    return media?.node?.caption || '';
}

async function downloadMedia(sock, message, key) {
    const target = { key, message };
    return downloadMediaMessage(target, 'buffer', {}, {
        logger: silentLogger,
        reuploadRequest: sock.updateMediaMessage,
    });
}

async function streamBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

async function downloadFrom(sock, msg, chat, preferQuoted = true) {
    const quoted = preferQuoted ? quotedOf(msg.message, chat) : null;
    const source = quoted || { message: msg.message, key: msg.key };
    const media = findMedia(source.message);
    if (!media) return null;

    // Quote/reply payloads often arrive without a usable media key. Try the
    // normal download first, then the direct stream path main MD uses.
    let buffer = null;
    let firstError = null;
    try {
        buffer = await downloadMedia(sock, source.message, source.key);
    } catch (error) {
        firstError = error;
    }
    if (!buffer) {
        try {
            buffer = await streamBuffer(await downloadContentFromMessage(media.node, media.kind));
        } catch {
            throw firstError || new Error('media download failed');
        }
    }
    if (buffer && buffer.length > config.maxMediaBytes) {
        throw new Error(`Media is too large (${humanBytes(buffer.length)} > ${humanBytes(config.maxMediaBytes)})`);
    }
    return { ...media, buffer, quoted: Boolean(quoted) };
}

function jidNumber(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

function normalizeJid(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.includes('@')) return jidNormalizedUser(raw);
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? `${digits}@s.whatsapp.net` : '';
}

function isGroupJid(jid) {
    return String(jid || '').endsWith('@g.us');
}

function resolveTarget(msg, chat, text, mentioned = []) {
    if (mentioned.length) return normalizeJid(mentioned[0]);
    const quoted = quotedOf(msg.message || msg, chat);
    if (quoted?.key?.participant) return normalizeJid(quoted.key.participant);
    const match = String(text || '').match(/(\+?\d[\d\s-]{8,17}\d)/);
    if (match) return normalizeJid(match[1]);
    return '';
}

function mentionedJids(message) {
    return contextInfoOf(message)?.mentionedJid || [];
}

function parsePoll(input) {
    const parts = String(input || '').split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) return null;
    return { question: parts[0], options: parts.slice(1, 13) };
}

function extractUrl(text) {
    const match = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
    return match ? match[0] : '';
}

function isUrl(text) {
    return /^https?:\/\//i.test(String(text || '').trim());
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function humanBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function humanUptime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}

function shortText(text, max = 60) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function usageBox(prefix, lines) {
    return [`╭─ ⚠️ 𝗨𝗦𝗔𝗚𝗘`, ...lines.map((line) => `│ ${line}`), '╰─'].join('\n');
}

function stamp(date = new Date()) {
    return date.toLocaleString('en-GB', { hour12: false });
}

async function withTimeout(promiseOrFactory, ms, label = 'operation') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const value = typeof promiseOrFactory === 'function' ? promiseOrFactory(controller.signal) : promiseOrFactory;
        return await value;
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error(`${label} timed out after ${Math.round(ms / 1000)}s`);
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchJson(url, options = {}, timeoutMs = 20_000) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
    return response.json();
}

async function fetchText(url, options = {}, timeoutMs = 20_000) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
    return response.text();
}

// Vibrant status backgrounds. WhatsApp renders a gradient from backgroundColor,
// and the font cycles 0-8 for text statuses only.
const STATUS_BG_COLORS = [
    '#1E90FF', '#7C4DFF', '#E53935', '#00897B', '#F4511E', '#D81B60',
    '#3949AB', '#43A047', '#6A1B9A', '#FBC02D', '#00ACC1', '#5E35B1',
];
let statusBgIndex = -1;
let statusFontIndex = -1;
function nextStatusBg() {
    statusBgIndex = (statusBgIndex + 1) % STATUS_BG_COLORS.length;
    return STATUS_BG_COLORS[statusBgIndex];
}
function nextStatusFont() {
    statusFontIndex = (statusFontIndex + 1) % 9;
    return statusFontIndex;
}

function statusMessageKey(inside) {
    return Object.keys(inside || {}).find((key) => key !== 'messageContextInfo');
}

function groupStatusSourceType(content) {
    if (content?.image || content?.sticker) return 0; // IMAGE
    if (content?.video) return 1; // VIDEO
    if (content?.audio) return 3; // AUDIO
    return 4; // TEXT
}

function groupStatusContext(content, sock) {
    const authorJid = sock.user?.id || '';
    return {
        featureEligibilities: { canReceiveMultiReact: true },
        statusSourceType: groupStatusSourceType(content),
        statusAttributions: [{ type: 5, groupStatus: { authorJid } }],
        isGroupStatus: true,
        statusAudienceMetadata: { audienceType: 1 },
    };
}

async function postStatus(sock, recipients, content) {
    const isText = !content?.image && !content?.video && !content?.audio && !content?.sticker;
    const options = { upload: sock.waUploadToServer };
    if (isText) {
        options.backgroundColor = nextStatusBg();
        options.font = nextStatusFont();
    }
    const inside = await generateWAMessageContent(content, options);
    // Status messages must be attributed to the connected account, otherwise WhatsApp
    // accepts the stanza and never shows it to anyone.
    const message = generateWAMessageFromContent('status@broadcast', inside, {
        userJid: sock.user?.id,
    });
    const audience = [...new Set(recipients.filter(Boolean))];
    const self = jidNumber(sock.user?.id);
    if (self) audience.unshift(`${self}@s.whatsapp.net`);
    await sock.relayMessage('status@broadcast', message.message, {
        messageId: message.key.id,
        statusJidList: [...new Set(audience)],
    });
    return message;
}

async function postGroupStatus(sock, groupJid, content) {
    const isText = !content?.image && !content?.video && !content?.audio && !content?.sticker;
    const options = { upload: sock.waUploadToServer };
    if (isText) {
        options.backgroundColor = nextStatusBg();
        options.font = nextStatusFont();
    }
    const inside = await generateWAMessageContent(content, options);
    const key = statusMessageKey(inside);
    if (!key || !inside[key]) throw new Error('empty group status payload');

    inside[key].contextInfo = {
        ...(inside[key].contextInfo || {}),
        ...groupStatusContext(content, sock),
    };
    if (key === 'extendedTextMessage') {
        inside[key].textArgb = 0xFFFFFFFF;
        inside[key].previewType = 0;
        inside[key].inviteLinkGroupTypeV2 = 0;
    }

    // Direct group relay is the route that renders group-status media. The
    // correct GROUP_STATUS attribution (type 5) + authorJid marks it as a group
    // story rather than a plain media message.
    const message = generateWAMessageFromContent(groupJid, inside, {});
    await sock.relayMessage(groupJid, message.message, { messageId: message.key.id });
    return message;
}

async function imageFromContext(ctx) {
    const media = await downloadFrom(ctx.sock, ctx.msg, ctx.chat, true);
    if (media && media.kind === 'image') return media.buffer;
    const url = extractUrl(ctx.text);
    if (url) {
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`image download failed (HTTP ${response.status})`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > config.maxMediaBytes) throw new Error('image is too large');
        return buffer;
    }
    return null;
}

async function contentFromContext(ctx) {
    const quoted = quotedOf(ctx.msg.message, ctx.chat);
    const caption = ctx.text || (quoted ? extractText(quoted.message) : '');
    // A failed download must not crash the command. Fall back to the quoted
    // caption (or the usage text) exactly like main MD does.
    let media = null;
    try {
        media = await downloadFrom(ctx.sock, ctx.msg, ctx.chat, true);
    } catch {
        media = null;
    }
    if (media) {
        if (media.kind === 'image') return { image: media.buffer, caption };
        if (media.kind === 'video') return { video: media.buffer, caption };
        if (media.kind === 'audio') {
            return { audio: media.buffer, mimetype: media.node?.mimetype || 'audio/mpeg', ptt: Boolean(media.node?.ptt) };
        }
        if (media.kind === 'sticker') return { sticker: media.buffer };
        if (media.kind === 'document' && String(media.node?.mimetype || '').startsWith('image/')) {
            return { image: media.buffer, caption };
        }
        return null;
    }
    // Never fall back to the command text itself: a reply to a non-text message
    // must produce a usage reply, not post ".tomystatus" as the status.
    return caption ? { text: caption } : null;
}

function brandFooter() {
    return '©2026 The Cortana Tech';
}

module.exports = {
    silentLogger,
    unwrap,
    isViewOnce,
    extractText,
    contextInfoOf,
    quotedOf,
    findMedia,
    messageType,
    mediaCaption,
    downloadMedia,
    downloadFrom,
    jidNumber,
    normalizeJid,
    isGroupJid,
    resolveTarget,
    mentionedJids,
    parsePoll,
    extractUrl,
    isUrl,
    sleep,
    pick,
    randInt,
    shuffle,
    humanBytes,
    humanUptime,
    shortText,
    usageBox,
    stamp,
    withTimeout,
    fetchJson,
    fetchText,
    postStatus,
    postGroupStatus,
    imageFromContext,
    contentFromContext,
    brandFooter,
};
