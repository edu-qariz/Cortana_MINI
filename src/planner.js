'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const licence = require('./licence');
const logger = require('./logger');
const mediaTools = require('./media');
const brand = require('./brand');
const ytdlp = require('./ytdlp');
const ytdl = require('@distube/ytdl-core');
const { resolveAudio, resolveVideo } = require('./media-api');
const store = require('./store');
const updateModule = require('./update');
const {
    humanUptime,
    humanBytes,
    quotedOf,
    findMedia,
    isViewOnce,
    downloadMedia,
    jidNumber,
    normalizeJid,
    postStatus,
    postGroupStatus,
} = require('./helpers');

const MAX_STEPS = 8;
const STEP_TIMEOUT_MS = 20_000;
const MAX_SCHEDULE_MS = 30 * 60_000;
const MAX_SCHEDULES = 16;
const DEFAULT_PROMPT_TTL_MS = 5 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

async function collectStream(stream, maxBytes, label) {
    const chunks = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
        if (!settled) stream.destroy(new Error(`${label} timed out`));
    }, DOWNLOAD_TIMEOUT_MS);
    if (timer.unref) timer.unref();
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

const pending = new Map();
const schedules = new Map();
const history = new Map();
const unsupported = new Set();

const planError = (code, message) => Object.assign(new Error(message || code), { code });

function resolve(value, vars) {
    if (typeof value === 'string') {
        return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key) => {
            const [id, ...rest] = key.split('.');
            if (!(id in vars)) return whole;
            const picked = rest.reduce((acc, part) => (acc == null ? acc : acc[part]), vars[id]);
            return picked === undefined || picked === null ? whole : String(picked);
        });
    }
    if (Array.isArray(value)) return value.map((item) => resolve(item, vars));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, vars)]));
    }
    return value;
}

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(planError('step_timeout', `step exceeded ${ms}ms`)), ms);
        if (timer.unref) timer.unref();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function safePath(input) {
    const home = path.resolve(config.paths.home);
    const target = path.resolve(home, String(input));
    if (target !== home && !target.startsWith(home + path.sep)) {
        throw planError('bad_path', 'path resolves outside the state folder');
    }
    return target;
}

function pickFields(value, fields) {
    const out = {};
    for (const field of fields) {
        const picked = String(field).split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), value);
        if (picked !== undefined) out[field] = picked;
    }
    return out;
}

function jidList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function resolveSource(source, vars) {
    if (source.menu) {
        if (fs.existsSync(config.paths.menuImage)) return { buffer: fs.readFileSync(config.paths.menuImage), kind: 'image' };
        throw planError('missing_media', 'no menu image is set');
    }
    if (source.url) return { url: source.url, kind: 'image' };
    if (source.step) {
        const ref = vars[source.step];
        if (!ref) throw planError('missing_media', `step ${source.step} produced nothing`);
        if (Buffer.isBuffer(ref.buffer)) {
            return { buffer: ref.buffer, kind: ref.kind || 'image', mimetype: ref.mimetype, caption: ref.caption };
        }
        if (ref.url) return { url: ref.url, kind: ref.kind || 'image' };
        throw planError('missing_media', `step ${source.step} has no media`);
    }
    if (source.path) return { buffer: fs.readFileSync(safePath(source.path)), kind: 'image' };
    throw planError('missing_media', 'media step has no source');
}

function mediaPayload(kind, data, args, fallbackCaption) {
    const payload = {};
    const caption = args.caption || fallbackCaption;
    const mentions = Array.isArray(args.mentions) ? args.mentions : undefined;
    if (kind === 'sticker') {
        if (!Buffer.isBuffer(data)) throw planError('missing_media', 'stickers need a buffer source');
        payload.sticker = data;
    } else if (kind === 'audio') {
        payload.audio = data;
        payload.mimetype = args.mimetype || 'audio/mp4';
        payload.ptt = Boolean(args.ptt);
    } else if (kind === 'video') {
        payload.video = data;
        payload.caption = caption;
        if (mentions) payload.mentions = mentions;
    } else if (kind === 'document') {
        payload.document = data;
        payload.mimetype = args.mimetype || 'application/octet-stream';
        payload.fileName = args.fileName || 'file';
        payload.caption = caption;
    } else {
        payload.image = data;
        payload.caption = caption;
        if (mentions) payload.mentions = mentions;
    }
    return payload;
}

async function quotedMedia(ctx, args) {
    const quoted = quotedOf(ctx.msg.message, ctx.chat);
    const source = quoted || { message: ctx.msg.message, key: ctx.msg.key };
    if (args.viewOnce && !isViewOnce(source.message)) throw planError('missing_media', 'that message is not view-once');
    const media = findMedia(source.message);
    if (!media) throw planError('missing_media', 'no media found in that message');
    const buffer = await downloadMedia(ctx.sock, source.message, source.key);
    const node = media.node || {};
    return {
        buffer,
        kind: media.kind,
        mimetype: node.mimetype || '',
        caption: node.caption || '',
        fileName: node.fileName || '',
    };
}

function statusContent(ctx) {
    const quoted = quotedOf(ctx.msg.message, ctx.chat);
    if (quoted) {
        const media = findMedia(quoted.message);
        if (media) return { media: true };
        const text = quoted.message?.conversation || quoted.message?.extendedTextMessage?.text || '';
        if (text) return { text };
    }
    if (ctx.text) return { text: ctx.text };
    return null;
}

const handlers = {
    async html(ctx, args) {
        const surface = String(args.surface || '');
        if (!surface) throw planError('bad_html', 'no surface named');
        const base = config.apiBaseUrl.replace(/\/+$/, '');
        const query = new URLSearchParams({ bot: String(store.getSettings().botName || 'CORTANA PRO MINI') });
        if (Array.isArray(args.options) && args.options.length) query.set('options', args.options.join('|'));
        const url = `${base}/v1/html/${encodeURIComponent(surface)}?${query.toString()}`;

        const response = await fetch(url, { signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
        if (!response.ok) throw planError('html_unavailable', `surface ${surface} returned ${response.status}`);
        const document = await response.text();
        const { sendHtmlMessage } = require('./html-ui');
        await sendHtmlMessage(ctx.sock, ctx.chat, document);
        return { ok: true };
    },

    async say(ctx, args) {
        const text = String(args.text || '');
        if (!text) return { skipped: true };
        const mentions = Array.isArray(args.mentions) ? args.mentions : undefined;
        await ctx.sock.sendMessage(
            ctx.chat,
            brand.branded(mentions ? { text, mentions } : { text }),
            { quoted: brand.brandedQuote() }
        );
        logger.outgoing({ chat: ctx.chat, kind: 'text', preview: text, ms: 0 });
        return { ok: true };
    },

    async react(ctx, args) {
        if (!args.emoji) return { skipped: true };
        await ctx.react(String(args.emoji));
        return { ok: true };
    },

    async media(ctx, args, vars) {
        const source = resolveSource(args.source || {}, vars);
        const kind = args.kind && args.kind !== 'auto' ? args.kind : source.kind || 'image';

        if (args.persist === 'menuImage') {
            const buffer = source.buffer
                || Buffer.from(await (await fetch(source.url)).arrayBuffer());
            fs.writeFileSync(config.paths.menuImage, buffer);
            store.updateSettings({ menuImage: 'local' });
            if (args.text) await ctx.reply(String(args.text));
            return { ok: true, persisted: true };
        }

        const data = source.buffer || { url: source.url };
        const payload = mediaPayload(kind, data, args, source.caption);
        const target = args.to ? normalizeJid(args.to) || args.to : null;
        if (target && target !== ctx.chat) {
            await ctx.sock.sendMessage(target, payload);
            logger.outgoing({ chat: target, kind, preview: '[media]', ms: 0 });
        } else {
            await ctx.sock.sendMessage(ctx.chat, brand.branded(payload), { quoted: brand.brandedQuote() });
            logger.outgoing({ chat: ctx.chat, kind, preview: '[media]', ms: 0 });
        }
        return { ok: true };
    },

    async http(ctx, args) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Number(args.timeoutMs) || STEP_TIMEOUT_MS);
        if (timer.unref) timer.unref();
        try {
            const response = await fetch(args.url, {
                method: args.method || 'GET',
                headers: args.headers || {},
                body: args.body,
                signal: controller.signal,
            });
            const bytes = Buffer.from(await response.arrayBuffer());
            if (!response.ok) throw planError('http_error', `HTTP ${response.status} from ${args.url}`);
            if (args.saveAs) fs.writeFileSync(safePath(args.saveAs), bytes);

            const expect = args.expect || 'json';
            if (expect === 'buffer') {
                return { buffer: bytes, mimetype: response.headers.get('content-type') || '' };
            }
            const text = bytes.toString('utf8');
            if (expect === 'text') return { text };
            const parsed = JSON.parse(text);
            return { body: Array.isArray(args.pick) ? pickFields(parsed, args.pick) : parsed };
        } finally {
            clearTimeout(timer);
        }
    },

    async transform(ctx, args, vars) {
        const ref = vars[args.from && args.from.step];
        if (!ref || !Buffer.isBuffer(ref.buffer)) throw planError('missing_media', 'transform needs a buffer input');
        const target = args.to || 'sticker';
        if (target === 'image') return { buffer: await mediaTools.toImage(ref.buffer), kind: 'image', mimetype: 'image/png' };
        if (target === 'audio') return { buffer: await mediaTools.toMp3(ref.buffer), kind: 'audio', mimetype: 'audio/mpeg' };
        if (target === 'sticker') return { buffer: await mediaTools.toSticker(ref.buffer), kind: 'sticker', mimetype: 'image/webp' };
        if (target === 'tempo') {
            const rate = Math.min(2, Math.max(0.5, Number(args.rate) || 1));
            return { buffer: await mediaTools.changeTempo(ref.buffer, rate), kind: 'audio', mimetype: 'audio/mpeg' };
        }
        throw planError('unsupported_transform', `transform.${target} is not implemented`);
    },

    async query(ctx, args) {
        if (args.what === 'group') {
            const meta = await ctx.groupMeta(args.jid || ctx.chat);
            return { id: meta.id, subject: meta.subject, size: (meta.participants || []).length };
        }
        if (args.what === 'participants') {
            const meta = await ctx.groupMeta(args.jid || ctx.chat);
            const entries = (meta.participants || [])
                .map((entry) => ({ id: normalizeJid(entry.id || entry.lid), admin: entry.admin || null }))
                .filter((entry) => entry.id);
            const jids = [...new Set(entries.map((entry) => entry.id))];
            const admins = [...new Set(entries.filter((entry) => entry.admin).map((entry) => entry.id))];
            const tag = (list) => list.slice(0, 60).map((jid) => `@${jidNumber(jid)}`).join(' ');
            return {
                jids: jids.join(','),
                admins: admins.join(','),
                taglist: tag(jids),
                admintaglist: tag(admins),
                size: jids.length,
            };
        }
        if (args.what === 'profilePic') {
            return { url: await ctx.sock.profilePictureUrl(args.jid || ctx.chat, 'image') };
        }
        if (args.what === 'media') {
            return quotedMedia(ctx, args);
        }
        if (args.what === 'statusContent') {
            const content = statusContent(ctx);
            if (!content) throw planError('missing_media', 'nothing to post');
            if (!content.media) return { content: { text: content.text } };
            const media = await quotedMedia(ctx, {});
            return { content: mediaPayload(media.kind, media.buffer, {}, media.caption) };
        }
        if (args.what === 'allGroups') {
            const participating = await ctx.sock.groupFetchAllParticipating();
            const jids = Object.values(participating || {}).map((group) => group.id).filter(Boolean);
            return { jids: jids.join(','), count: jids.length };
        }
        throw planError('unsupported_query', `query.${args.what} is not implemented`);
    },

    async mutate(ctx, args, vars) {
        const jid = args.jid || ctx.chat;
        const targets = jidList(args.jids);
        switch (args.op) {
            case 'description':
                await ctx.sock.groupUpdateDescription(jid, String(args.text || ''));
                return { ok: true };
            case 'picture': {
                const source = resolveSource(args.source || {}, vars);
                const buffer = source.buffer || Buffer.from(await (await fetch(source.url)).arrayBuffer());
                await ctx.sock.updateProfilePicture(jid, buffer);
                return { ok: true };
            }
            case 'inviteCode':
                return { code: await ctx.sock.groupInviteCode(jid) };
            case 'poll':
                await ctx.reply({
                    poll: {
                        name: String(args.text || 'Poll'),
                        values: (args.options || []).slice(0, 12).map(String),
                        selectableCount: Number(args.selectableCount) || 1,
                    },
                });
                return { ok: true };
            case 'tag': {
                const text = String(args.text || '');
                await ctx.reply(text ? { text, mentions: targets } : { text: '', mentions: targets });
                return { ok: true, mentioned: targets.length };
            }
            case 'upload': {
                const ref = vars[args.source && args.source.step];
                if (!ref || !Buffer.isBuffer(ref.buffer)) throw planError('missing_media', 'nothing to upload');
                const extension = ref.kind === 'sticker' ? 'webp' : ref.kind === 'video' ? 'mp4' : ref.kind === 'image' ? 'jpg' : 'bin';
                const url = await mediaTools.uploadCatbox(ref.buffer, `cortana-mini.${extension}`);
                return { url, bytes: ref.buffer.length };
            }
            case 'ytdl': {
                const url = String(args.url || '');
                if (!/^https?:\/\//i.test(url)) throw planError('bad_url', 'not a media url');
                if (args.mode === 'audio') {
                    const fromYtdlp = await ytdlp.downloadAudio(url).catch(() => null);
                    if (fromYtdlp) {
                        await ctx.sock.sendMessage(ctx.chat, { audio: fromYtdlp, mimetype: 'audio/mpeg', fileName: args.fileName || 'audio.mp3', ptt: false });
                        return { ok: true, via: 'yt-dlp' };
                    }
                    const resolved = await resolveAudio(url).catch(() => null);
                    if (resolved?.url) {
                        await ctx.reply({ audio: { url: resolved.url }, mimetype: 'audio/mpeg', fileName: args.fileName || 'audio.mp3', ptt: false });
                        return { ok: true, via: 'resolver' };
                    }
                    const stream = ytdl(url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
                    const raw = await collectStream(stream, config.maxMediaBytes, 'audio');
                    const mp3 = await mediaTools.toMp3(raw);
                    await ctx.sock.sendMessage(ctx.chat, { audio: mp3, mimetype: 'audio/mpeg', fileName: args.fileName || 'audio.mp3', ptt: false });
                    return { ok: true, via: 'ytdl' };
                }
                const fromYtdlp = await ytdlp.downloadVideo(url).catch(() => null);
                if (fromYtdlp) {
                    await ctx.sock.sendMessage(ctx.chat, { video: fromYtdlp, mimetype: 'video/mp4', caption: args.caption });
                    return { ok: true, via: 'yt-dlp' };
                }
                const resolved = await resolveVideo(url).catch(() => null);
                if (resolved?.url) {
                    await ctx.reply({ video: { url: resolved.url }, mimetype: 'video/mp4', caption: args.caption });
                    return { ok: true, via: 'resolver' };
                }
                const stream = ytdl(url, { filter: 'audioandvideo', quality: '18', highWaterMark: 1 << 25 });
                const buffer = await collectStream(stream, config.maxMediaBytes, 'video');
                await ctx.sock.sendMessage(ctx.chat, { video: buffer, mimetype: 'video/mp4', caption: args.caption });
                return { ok: true, via: 'ytdl' };
            }
            case 'status': {
                const content = args.content && typeof args.content === 'object' ? args.content : { text: String(args.text || '') };
                if (!content.text && !content.image && !content.video && !content.audio) {
                    throw planError('missing_media', 'nothing to post');
                }
                if (args.targets === 'self') {
                    const recipients = new Set();
                    for (const number of store.ownerList()) recipients.add(`${number}@s.whatsapp.net`);
                    recipients.add(normalizeJid(ctx.chat));
                    for (const contact of store.contactList()) recipients.add(contact);
                    await postStatus(ctx.sock, [...recipients].filter(Boolean).slice(0, 200), content);
                    return { ok: true, count: recipients.size };
                }
                const wanted = jidList(args.targets);
                if (!wanted.length) throw planError('missing_targets', 'no targets');
                let posted = 0;
                for (const target of wanted.slice(0, 90)) {
                    try {
                        if (target.endsWith('@g.us')) await postGroupStatus(ctx.sock, target, content);
                        else await postStatus(ctx.sock, [target], content);
                        posted += 1;
                    } catch (error) {
                        logger.warn(`status post failed for ${target}: ${error.message}`);
                    }
                }
                return { ok: true, count: posted };
            }
            default:
                throw planError('unsupported_op', `mutate.${args.op} is not implemented`);
        }
    },

    async remember(ctx, args) {
        const scope = args.scope || 'settings';
        if (scope === 'settings') {
            store.updateSettings({ [String(args.key)]: args.value });
            return { ok: true };
        }
        if (scope === 'chat') {
            store.updateChat(args.jid || ctx.chat, { [String(args.key)]: args.value });
            return { ok: true };
        }
        if (scope === 'contact') {            store.addContact(String(args.value || ''));
            return { ok: true };
        }
        throw planError('unsupported_scope', `remember.${scope} is not implemented`);
    },

    async recall(ctx, args) {
        const scope = args.scope || 'settings';
        if (scope === 'settings') return { ...store.getSettings() };
        if (scope === 'chat') return { ...store.getChat(args.jid || ctx.chat) };
        throw planError('unsupported_scope', `recall.${scope} is not implemented`);
    },

    async runtime(ctx, args) {
        if (args.op === 'restart') {
            if (!ctx.isOwner) throw planError('forbidden', 'owner only');
            setImmediate(() => {
                ctx.restart().catch((error) => logger.error('planner.restart', error));
            });
            return { restarting: true };
        }
        if (args.op === 'update') {
            if (!ctx.isOwner) throw planError('forbidden', 'owner only');
            const check = await updateModule.check().catch((error) => ({ ok: false, code: error.code || 'update_error', error: error.message }));
            if (!check.ok) return { message: `📦 *UPDATE*\n\n✖ check failed: \`${check.code}\`${check.error ? `\n${check.error}` : ''}` };
            if (!check.update) return { message: `📦 *UPDATE*\n\n✅ *${check.current}* is the latest build on \`${config.channel}\`.` };
            const zip = await updateModule.download(check.manifest);
            await updateModule.stage(zip, check.manifest);
            return {
                message:
                    `📦 *UPDATE ${check.manifest.version}*\n\n`
                    + '✅ signature verified\n✅ artifact sha256 verified\n✅ staged and smoke-tested\n\n'
                    + 'Stop the bot, then run:\n`node tools/apply-update.js`',
            };
        }
        const started = Date.now();
        await ctx.react('🏓').catch(() => {});
        return {
            latencyMs: Math.max(1, Date.now() - started),
            uptime: humanUptime(process.uptime() * 1000),
            version: config.versionLabel,
            time: new Date().toLocaleString('en-GB', { hour12: false }),
            rssMb: Math.round(process.memoryUsage().rss / 1048576),
        };
    },

    async schedule(ctx, args) {
        const delay = Math.min(MAX_SCHEDULE_MS, Math.max(0, Number(args.inMs) || 0));
        const perChat = schedules.get(ctx.chat) || new Set();
        if (perChat.size >= MAX_SCHEDULES) throw planError('too_many_schedules', 'too many timers in this chat');
        const timer = setTimeout(() => {
            perChat.delete(timer);
            run(ctx, { steps: args.steps || [] }).catch((error) => logger.error('planner.schedule', error));
        }, delay);
        if (timer.unref) timer.unref();
        perChat.add(timer);
        schedules.set(ctx.chat, perChat);
        return { scheduled: true, inMs: delay };
    },

    async prompt(ctx, args) {
        if (args.text) await ctx.reply(String(args.text));
        pending.set(ctx.chat, {
            expect: args.expect || 'text',
            choices: (args.choices || []).map(String),
            steps: args.onReply || [],
            at: Date.now(),
            ttlMs: Math.min(DEFAULT_PROMPT_TTL_MS, Number(args.ttlMs) || DEFAULT_PROMPT_TTL_MS),
        });
        return { waiting: true };
    },
};

async function run(ctx, plan) {
    const steps = Array.isArray(plan && plan.steps) ? plan.steps : [];
    if (!steps.length) throw planError('empty_plan', 'plan has no steps');
    if (steps.length > MAX_STEPS) throw planError('plan_too_long', `plan has ${steps.length} steps, max is ${MAX_STEPS}`);
    if (plan.expiresAt && Date.parse(plan.expiresAt) < Date.now()) {
        logger.debug('dropped an expired plan');
        return false;
    }

    const vars = { settings: store.getSettings(), chat: store.getChat(ctx.chat) };
    let sent = false;
    for (const step of steps) {
        const handler = handlers[step.use];
        if (!handler) throw planError('unknown_step', `unknown primitive "${step.use}"`);
        try {
            const args = resolve(step.args || {}, vars);
            vars[step.id || step.use] = (await withTimeout(handler(ctx, args, vars), STEP_TIMEOUT_MS)) || {};
            if (step.use === 'say' || step.use === 'media' || step.use === 'mutate') sent = true;
        } catch (error) {
            logger.warn(`plan ${step.use} failed: ${error.code || error.message}`);
            if (step.onError === 'skip') continue;
            if (plan.fallbackText && !sent) {
                await ctx.reply(plan.fallbackText).catch(() => {});
                return true;
            }
            throw error;
        }
    }
    return vars;
}

function quotedSummary(ctx) {
    const quoted = quotedOf(ctx.msg.message, ctx.chat);
    if (!quoted) return { present: false };
    const message = quoted.message || {};
    const media = findMedia(message);
    return {
        present: true,
        viewOnce: isViewOnce(message),
        kind: media ? media.kind : null,
        hasMedia: Boolean(media),
        caption: (media && media.node && media.node.caption) || '',
        text: message.conversation || message.extendedTextMessage?.text || '',
    };
}

// Returns true when the Worker produced a plan, so the local command must not run.
async function runFor(ctx, def) {
    if (!licence.configured()) return false;
    if (unsupported.has(def.name)) return false;

    const result = await licence.planFor(
        def.name,
        ctx.args,
        {
            group: ctx.isGroup,
            owner: ctx.isOwner,
            admin: ctx.isAdmin,
            prefix: ctx.prefix,
            sender: ctx.senderNum || ctx.chat,
            senderJid: ctx.sender,
            hour: new Date().getHours(),
            chatJid: ctx.chat,
            version: config.versionLabel,
            settings: { ...store.getSettings() },
            chat: { ...store.getChat(ctx.chat) },
            quoted: quotedSummary(ctx),
            mentions: ctx.msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [],
            history: [],
        }
    );

    if (!result.ok) {
        logger.warn(`plan unavailable for ${def.name} (${result.code}) — running it locally`);
        return false;
    }
    if (result.data.unsupported) {
        unsupported.add(def.name);
        return false;
    }

    try {
        await run(ctx, result.data);
        return true;
    } catch (error) {
        if (result.data.fallbackText) {
            await ctx.reply(result.data.fallbackText).catch(() => {});
            return true;
        }
        throw error;
    }
}

async function chatReply(ctx, text) {
    if (!licence.configured() || !text) return null;

    const perChat = history.get(ctx.chat) || [];
    const result = await licence.planFor(
        'chatbot',
        [text],
        {
            group: ctx.isGroup,
            owner: ctx.isOwner,
            prefix: ctx.prefix,
            sender: ctx.senderNum || ctx.chat,
            chatJid: ctx.chat,
            version: config.versionLabel,
            settings: { ...store.getSettings() },
            chat: { ...store.getChat(ctx.chat) },
            quoted: quotedSummary(ctx),
            history: perChat.slice(-8),
        }
    );
    if (!result.ok || result.data.unsupported) return null;

    const vars = await run(ctx, result.data);
    const replyText = result.data.steps
        .map((step) => (step.use === 'say' ? vars[step.id] : null))
        .filter(Boolean)
        .map((entry) => entry.text)
        .filter(Boolean)
        .pop();
    if (replyText) {
        perChat.push({ role: 'user', content: String(text).slice(0, 1000) });
        perChat.push({ role: 'assistant', content: String(replyText).slice(0, 1500) });
        history.set(ctx.chat, perChat.slice(-10));
    }
    return replyText || null;
}

// Feeds a non-command message to a waiting prompt. Returns true when consumed.
function consume(ctx, text) {
    const entry = pending.get(ctx.chat);
    if (!entry) return false;
    if (Date.now() - entry.at > entry.ttlMs) {
        pending.delete(ctx.chat);
        return false;
    }
    const value = String(text || '').trim();
    if (entry.expect === 'number' && !/^-?\d+(?:\.\d+)?$/.test(value)) return false;
    if (entry.expect === 'choice' && !entry.choices.some((choice) => choice.toLowerCase() === value.toLowerCase())) return false;

    pending.delete(ctx.chat);
    run(ctx, { steps: entry.steps }).catch((error) => logger.error('planner.prompt', error));
    return true;
}

module.exports = {
    run,
    runFor,
    chatReply,
    consume,
    handlers,
    resolve,
    safePath,
    quotedSummary,
};
