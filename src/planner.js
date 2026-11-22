'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const licence = require('./licence');
const logger = require('./logger');
const mediaTools = require('./media');
const store = require('./store');
const { humanUptime } = require('./helpers');

const MAX_STEPS = 8;
const STEP_TIMEOUT_MS = 20_000;
const MAX_SCHEDULE_MS = 30 * 60_000;
const MAX_SCHEDULES = 16;
const DEFAULT_PROMPT_TTL_MS = 5 * 60_000;

const pending = new Map();
const schedules = new Map();
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

async function mediaSource(args, vars) {
    const source = args.source || {};
    if (source.url) return { url: source.url };
    if (source.step) {
        const ref = vars[source.step];
        if (!ref || !Buffer.isBuffer(ref.buffer)) throw planError('missing_media', `step ${source.step} produced no buffer`);
        return ref.buffer;
    }
    if (source.path) return fs.readFileSync(safePath(source.path));
    throw planError('missing_media', 'media step has no source');
}

function mediaPayload(kind, data, args) {
    const payload = {};
    if (kind === 'sticker') {
        if (!Buffer.isBuffer(data)) throw planError('missing_media', 'stickers need a buffer source');
        payload.sticker = data;
    } else if (kind === 'audio') {
        payload.audio = data;
        payload.mimetype = args.mimetype || 'audio/mp4';
        payload.ptt = Boolean(args.ptt);
    } else if (kind === 'video') {
        payload.video = data;
        payload.caption = args.caption;
    } else if (kind === 'document') {
        payload.document = data;
        payload.mimetype = args.mimetype || 'application/octet-stream';
        payload.fileName = args.fileName || 'file';
        payload.caption = args.caption;
    } else {
        payload.image = data;
        payload.caption = args.caption;
    }
    return payload;
}

const handlers = {
    async say(ctx, args) {
        const text = String(args.text || '');
        if (!text) return { skipped: true };
        const mentions = Array.isArray(args.mentions) ? args.mentions : undefined;
        await ctx.reply(mentions ? { text, mentions } : text);
        return { ok: true };
    },

    async react(ctx, args) {
        if (!args.emoji) return { skipped: true };
        await ctx.react(String(args.emoji));
        return { ok: true };
    },

    async media(ctx, args, vars) {
        const data = await mediaSource(args, vars);
        await ctx.reply(mediaPayload(args.kind || 'image', data, args));
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
        if (target === 'image') return { buffer: await mediaTools.toImage(ref.buffer), mimetype: 'image/png' };
        if (target === 'audio') return { buffer: await mediaTools.toMp3(ref.buffer), mimetype: 'audio/mpeg' };
        if (target === 'sticker') return { buffer: await mediaTools.toSticker(ref.buffer), mimetype: 'image/webp' };
        throw planError('unsupported_transform', `transform.${target} is not implemented`);
    },

    async query(ctx, args) {
        if (args.what === 'group') {
            const meta = await ctx.groupMeta(args.jid);
            return { id: meta.id, subject: meta.subject, size: (meta.participants || []).length };
        }
        if (args.what === 'participants') {
            const meta = await ctx.groupMeta(args.jid);
            return {
                participants: (meta.participants || []).map((entry) => ({ id: entry.id, admin: entry.admin || null })),
            };
        }
        if (args.what === 'profilePic') {
            return { url: await ctx.sock.profilePictureUrl(args.jid || ctx.chat, 'image') };
        }
        throw planError('unsupported_query', `query.${args.what} is not implemented`);
    },

    async mutate(ctx, args) {
        const jid = args.jid || ctx.chat;
        const targets = Array.isArray(args.jids) ? args.jids : [];
        switch (args.op) {
            case 'kick':
            case 'add':
            case 'promote':
            case 'demote': {
                const action = { kick: 'remove', add: 'add', promote: 'promote', demote: 'demote' }[args.op];
                await ctx.sock.groupParticipantsUpdate(jid, targets, action);
                return { ok: true, count: targets.length };
            }
            case 'subject':
                await ctx.sock.groupUpdateSubject(jid, String(args.text || ''));
                return { ok: true };
            case 'description':
                await ctx.sock.groupUpdateDescription(jid, String(args.text || ''));
                return { ok: true };
            case 'inviteReset':
                return { code: await ctx.sock.groupRevokeInvite(jid) };
            case 'poll':
                await ctx.reply({
                    poll: {
                        name: String(args.text || 'Poll'),
                        values: (args.options || []).slice(0, 12).map(String),
                        selectableCount: Number(args.selectableCount) || 1,
                    },
                });
                return { ok: true };
            case 'tag':
                await ctx.reply(args.text ? { text: String(args.text), mentions: targets } : { text: '', mentions: targets });
                return { ok: true, mentioned: targets.length };
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
        if (scope === 'contact') {
            store.addContact(String(args.value || ''));
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
    for (const step of steps) {
        const handler = handlers[step.use];
        if (!handler) throw planError('unknown_step', `unknown primitive "${step.use}"`);
        try {
            const args = resolve(step.args || {}, vars);
            vars[step.id || step.use] = (await withTimeout(handler(ctx, args, vars), STEP_TIMEOUT_MS)) || {};
        } catch (error) {
            logger.warn(`plan ${step.use} failed: ${error.code || error.message}`);
            if (step.onError !== 'skip') throw error;
        }
    }
    return true;
}

// Returns true when the Worker produced a plan (so the local command must not run).
async function runFor(ctx, def) {
    if (!licence.configured()) return false;
    if (unsupported.has(def.name)) return false;

    const result = await licence.planFor(
        def.name,
        { text: ctx.text || '', options: ctx.args.length ? ctx.args : [] },
        { group: ctx.isGroup, sender: ctx.senderNum || '', history: [] }
    );

    if (!result.ok) {
        logger.warn(`plan unavailable for ${def.name} (${result.code}) — running it locally`);
        return false;
    }
    if (result.data.unsupported) {
        unsupported.add(def.name);
        return false;
    }

    await run(ctx, result.data);
    return true;
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
    consume,
    handlers,
    resolve,
    safePath,
};
