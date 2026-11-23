'use strict';

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const baileys = require('@whiskeysockets/baileys');

const makeWASocket = baileys.default;
const {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    jidNormalizedUser,
} = baileys;

const config = require('./config');
const logger = require('./logger');
const store = require('./store');
const registry = require('./registry');
const licence = require('./licence');
const planner = require('./planner');
const update = require('./update');
const guards = require('./guards');
const mediaTools = require('./media');
const brand = require('./brand');
const channels = require('./channels');
const commandModules = require('./commands');
const { TTLMap, SeenSet, RateLimiter, pruneAll, stats: cacheStats } = require('./cache');
const {
    unwrap,
    extractText,
    messageType,
    findMedia,
    downloadMedia,
    normalizeJid,
    jidNumber,
} = require('./helpers');

const groupMetaCache = new TTLMap({ ttlMs: 5 * 60_000, max: 200, name: 'groupMeta' });
const messageCache = new TTLMap({ ttlMs: 10 * 60_000, max: 400, name: 'antiDelete' });
const retryCache = new TTLMap({ ttlMs: 60_000, max: 250, name: 'retry' });
const seen = new SeenSet({ ttlMs: 120_000, max: 4000 });
const limiter = new RateLimiter({ limit: config.rateLimitPer10s, windowMs: 10_000 });
const silentLogger = pino({ level: 'silent' });

let sock = null;
let connecting = false;
let manualClose = false;
let reconnectAttempts = 0;
let connectedAt = 0;
let pairingCode = '';
let pairingRequestedAt = 0;
let pairingExpiresAt = 0;
let pairingState = 'idle';
let pairingInFlight = null;
let qrSeen = false;
const PAIRING_TTL_MS = 60_000;
let maintenanceTimer = null;
let shuttingDown = false;
let restarting = false;

let signalPromise = null;
let signalResolve = null;
let signalDone = false;

function resetSignal() {
    signalDone = false;
    signalPromise = new Promise((resolve) => { signalResolve = resolve; });
}

function resolveSignal() {
    if (!signalDone) {
        signalDone = true;
        if (signalResolve) signalResolve();
    }
}

function waitForSignal(timeoutMs = 25_000) {
    if (signalDone) return Promise.resolve();
    return Promise.race([
        signalPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('socket did not become ready in time')), timeoutMs)),
    ]);
}

function connected() {
    return Boolean(sock && connectedAt && sock.ws?.isOpen);
}

async function getGroupMeta(jid) {
    const cached = groupMetaCache.get(jid);
    if (cached) return cached;
    const meta = await sock.groupMetadata(jid);
    groupMetaCache.set(jid, meta, 5 * 60_000);
    return meta;
}

async function isGroupAdmin(chat, jid) {
    try {
        const meta = await getGroupMeta(chat);
        const target = jidNumber(jid);
        const participant = (meta?.participants || []).find((entry) =>
            jidNumber(entry.id) === target || (entry.lid && jidNumber(entry.lid) === target)
        );
        return Boolean(participant && participant.admin);
    } catch {
        return false;
    }
}

async function isBotAdmin(chat) {
    try {
        const meta = await getGroupMeta(chat);
        const ids = [jidNumber(sock.user?.id), jidNumber(sock.user?.lid)].filter(Boolean);
        const participant = (meta?.participants || []).find((entry) =>
            ids.includes(jidNumber(entry.id)) || (entry.lid && ids.includes(jidNumber(entry.lid)))
        );
        return Boolean(participant && participant.admin);
    } catch {
        return false;
    }
}

async function handleRevoke(msg, chat, protocol) {
    const settings = store.getChat(chat);
    if (settings.antidelete !== 'on') return;
    const originalId = protocol?.key?.id;
    if (!originalId) return;
    const original = messageCache.get(originalId);
    if (!original) return;

    const text = extractText(original);
    const media = findMedia(original);
    const header = '🗑️ *ANTI-DELETE*';
    try {
        if (media) {
            const key = {
                remoteJid: chat,
                id: originalId,
                participant: protocol.key.participant,
                fromMe: false,
            };
            const buffer = await downloadMedia(sock, original, key);
            const caption = media.node?.caption ? `${header}\n\n${media.node.caption}` : header;
            if (media.kind === 'image') await sock.sendMessage(chat, { image: buffer, caption });
            else if (media.kind === 'video') await sock.sendMessage(chat, { video: buffer, caption });
            else if (media.kind === 'audio') await sock.sendMessage(chat, { audio: buffer, mimetype: media.node?.mimetype || 'audio/mp4', ptt: false });
            else if (media.kind === 'sticker') await sock.sendMessage(chat, { sticker: buffer });
            else await sock.sendMessage(chat, { document: buffer, mimetype: media.node?.mimetype || 'application/octet-stream', fileName: 'deleted-file' });
        } else if (text) {
            await sock.sendMessage(chat, { text: `${header}\n\n${text}` });
        }
        logger.info(`anti-delete restored ${originalId.slice(0, 8)} in ${chat}`);
    } catch (error) {
        logger.warn(`anti-delete failed: ${error.message}`);
    }
}

async function runUpdate(ctx) {
    await ctx.react('📦').catch(() => {});
    try {
        const check = await update.check();
        if (!check.ok) {
            return ctx.reply(`📦 *UPDATE*\n\n✖ cannot check: \`${check.code}\``);
        }
        if (!check.update) {
            return ctx.reply(`📦 *UPDATE*\n\n✅ *${check.current}* is the latest build.`);
        }

        const zip = await update.download(check.manifest);
        const staged = await update.stage(zip, check.manifest);

        if (process.platform !== 'win32') {
            const applied = update.apply({ allowSelf: true });
            if (applied.ok) {
                await ctx.reply(`📦 *UPDATED TO ${applied.version}*\n\nrestarting into the new build…`);
                setTimeout(() => process.exit(0), 800);
                return;
            }
            return ctx.reply(`📦 *STAGED ${check.manifest.version}*\n\napply failed: \`${applied.code}\``);
        }

        return ctx.reply(
            `📦 *UPDATE ${check.manifest.version} STAGED*\n\n`
            + 'signature and hash verified.\n'
            + 'Stop the bot, then run:\n`node tools/apply-update.js`'
        );
    } catch (error) {
        logger.error('command.update', error);
        return ctx.reply(`📦 *UPDATE FAILED*\n\n\`${error.code || error.message}\``);
    }
}

async function maybeChatbot(ctx, text, isGroup) {
    if (!text) return;
    if (isGroup) {
        const info = ctx.msg.message?.extendedTextMessage?.contextInfo
            || ctx.msg.message?.imageMessage?.contextInfo
            || ctx.msg.message?.videoMessage?.contextInfo;
        const mentioned = (info?.mentionedJid || []).map(jidNumber);
        const selfIds = [jidNumber(sock.user?.id), jidNumber(sock.user?.lid)].filter(Boolean);
        const nameCalled = new RegExp(`\\b${String(ctx.settings.botName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
        if (!mentioned.some((id) => selfIds.includes(id)) && !nameCalled) return;
    }

    // Same trick the main MD bot uses: show "typing…" while the model thinks, so a
    // 3-second AI round trip does not look like the bot ignored the message.
    const typing = async (state) => {
        try {
            if (state === 'composing') await ctx.sock.presenceSubscribe(ctx.chat);
            await ctx.sock.sendPresenceUpdate(state, ctx.chat);
        } catch { /* presence is cosmetic */ }
    };

    try {
        await typing('composing');
        const delay = Math.min(4000, Math.max(1200, String(text).length * 40));
        const [replyText] = await Promise.all([
            planner.chatReply(ctx, text),
            new Promise((resolve) => setTimeout(resolve, delay)),
        ]);
        if (!replyText) logger.debug('chatbot produced no reply');
    } catch (error) {
        logger.warn(`chatbot reply failed: ${error.message}`);
    } finally {
        await typing('paused');
    }
}

function buildContext({ msg, chat, sender, senderNum, isGroup, isOwner, isAdmin, isBotAdmin, settings, chatSettings }) {
    const brandPayload = (content) => {
        const payload = typeof content === 'string' ? { text: content } : { ...content };
        if (typeof payload.text === 'string') payload.text = brand.withFooter(payload.text);
        if (typeof payload.caption === 'string') payload.caption = brand.withFooter(payload.caption);
        return brand.branded(payload);
    };

    const reply = async (content, extra = {}) => {
        const started = Date.now();
        const payload = brandPayload(content);
        const sent = await sock.sendMessage(chat, payload, { quoted: msg, ...extra });
        logger.outgoing({
            chat,
            kind: typeof content === 'string' ? 'text' : Object.keys(content)[0] || 'media',
            preview: typeof content === 'string' ? content : '[media]',
            ms: Date.now() - started,
        });
        return sent;
    };

    const send = async (content, extra = {}) => {
        const started = Date.now();
        const payload = brandPayload(content);
        const sent = await sock.sendMessage(chat, payload, extra);
        logger.outgoing({
            chat,
            kind: typeof content === 'string' ? 'text' : Object.keys(content)[0] || 'media',
            preview: typeof content === 'string' ? content : '[media]',
            ms: Date.now() - started,
        });
        return sent;
    };

    const react = (emoji) => sock.sendMessage(chat, { react: { text: emoji, key: msg.key } });

    return {
        sock,
        msg,
        chat,
        sender,
        senderNum,
        senderName: String(msg.pushName || '').trim(),
        isGroup,
        isOwner,
        isAdmin,
        isBotAdmin,
        settings,
        chatSettings,
        prefix: settings.prefix,
        command: '',
        args: [],
        text: '',
        raw: '',
        reply,
        send,
        react,
        restart,
        groupMeta: (jid) => getGroupMeta(jid || chat),
    };
}

async function dispatchCommand(ctx, name, args) {
    const def = registry.find(name);
    if (!def) return;

    if (def.ownerOnly && !ctx.isOwner) {
        return ctx.reply('🔒 *OWNER ONLY*\n\nThis button answers to the owner. Try something else. 😌');
    }
    if (def.groupOnly && !ctx.isGroup) {
        return ctx.reply('👥 *GROUP COMMAND*\n\nThis one only works inside a group.');
    }
    if (def.adminOnly && !ctx.isAdmin && !ctx.isOwner) {
        return ctx.reply('🛡️ *ADMINS ONLY*\n\nYou need admin rank for this. Politely grab a crown. 👑');
    }

    if (!ctx.isOwner && def.name !== 'update') {
        const verdict = limiter.take(ctx.senderNum || ctx.chat);
        if (!verdict.allowed) {
            return ctx.reply(`🧊 *CHILL* — too many commands.\n\nTry again in ${verdict.retryAfter || 5}s.`);
        }
    }

    // `.update` must work even when the licence is broken — it is the recovery path.
    if (def.name === 'update') {
        if (!ctx.isOwner) return ctx.reply('🔒 *OWNER ONLY*');
        return runUpdate(ctx);
    }

    if (!licence.configured()) {
        return ctx.reply(
            '⚙️ *NOT CONFIGURED*\n\n'
            + 'This install has no licence yet.\n\n'
            + `put \`CORTANA_API\` and \`LICENCE_KEY\` in:\n\`${config.paths.env}\`\n\n`
            + 'or add them as environment variables in your panel, then restart.'
        );
    }

    const gate = await licence.ensure();
    if (!gate.ok) {
        return ctx.reply(
            '🔐 *LICENCE CHECK FAILED*\n\n'
            + `reason: \`${gate.code}\`\n`
            + `server: ${config.apiBaseUrl}\n`
            + 'Check `LICENCE_KEY` and `CORTANA_API`, then restart.'
        );
    }

    ctx.command = def.name;
    ctx.args = args;
    ctx.text = args.join(' ');
    ctx.raw = [def.name, ...args].join(' ');
    logger.command({ name: def.name, sender: ctx.senderNum || ctx.sender, chat: ctx.chat, group: ctx.isGroup });
    store.bump('commands');

    try {
        if (await planner.runFor(ctx, def)) return;
    } catch (error) {
        logger.error(`plan.${def.name}`, error);
    }

    if (def.remoteOnly) {
        return ctx.reply(
            '📡 *CORTANA IS OFFLINE*\n\n'
            + 'The command service did not answer, so nothing ran.\n'
            + 'Check your connection and try again in a moment.'
        ).catch(() => {});
    }

    try {
        await def.execute(ctx);
    } catch (error) {
        logger.error(`command.${def.name}`, error);
        await ctx.reply(`💥 *COMMAND CRASHED*\n\n\`${def.name}\` hit an error: ${error.message}`).catch(() => {});
    }
}

async function handleMessage(msg) {
    try {
        const chat = msg.key?.remoteJid;
        if (!chat) return;
        if (chat === 'status@broadcast' || chat.endsWith('@newsletter') || chat.endsWith('@broadcast')) return;
        if (!msg.message) return;
        if (!seen.add(msg.key.id)) return;

        const protocol = unwrap(msg.message)?.protocolMessage;
        if (protocol) {
            await handleRevoke(msg, chat, protocol);
            return;
        }
        if (msg.message.reactionMessage) return;

        store.bump('messages');
        if (chat.endsWith('@s.whatsapp.net')) store.addContact(chat);

        const text = extractText(msg.message);
        const type = messageType(msg.message);
        const isGroup = chat.endsWith('@g.us');
        const senderRaw = isGroup ? (msg.key.participant || msg.participant || '') : chat;
        const sender = normalizeJid(senderRaw) || chat;
        const senderNum = jidNumber(sender);
        const settings = store.getSettings();
        const chatSettings = store.getChat(chat);
        const prefix = settings.prefix || '.';
        const fromMe = Boolean(msg.key.fromMe);
        const selfIds = [jidNumber(sock.user?.id), jidNumber(sock.user?.lid)].filter(Boolean);
        const isSelf = fromMe && (!senderNum || selfIds.includes(senderNum));
        const isOwner = config.ownerNumbers.includes(senderNum) || store.isOwner(senderNum) || isSelf;
        const isCommand = text.startsWith(prefix);

        if (fromMe && !isCommand) return;

        retryCache.set(msg.key.id, msg.message);
        if (chatSettings.antidelete === 'on') messageCache.set(msg.key.id, msg.message);

        logger.incoming({
            chat,
            sender: senderNum || sender,
            type,
            text: text || `[${type}]`,
            group: isGroup,
        });

        if (msg.message?.interactiveResponseMessage) {
            logger.info(`interactive response → ${JSON.stringify(text).slice(0, 120)}`);
        }

        if (settings.mode === 'self' && !isOwner) return;

        const isAdmin = isGroup ? await isGroupAdmin(chat, sender) : false;
        const botAdmin = isGroup ? await isBotAdmin(chat) : false;

        const ctx = buildContext({
            msg,
            chat,
            sender,
            senderNum,
            isGroup,
            isOwner,
            isAdmin: isAdmin || isOwner,
            isBotAdmin: botAdmin,
            settings,
            chatSettings,
        });

        // Older picker cards used toall:<target> ids. Keep them working.
        if (text.startsWith('toall:')) {
            const id = text.slice('toall:'.length);
            const args = id.toUpperCase() === 'ALL'
                ? ['all']
                : id.toUpperCase() === 'CANCEL'
                    ? ['cancel']
                    : ['g', id];
            await dispatchCommand(ctx, 'toallstatus', args);
            return;
        }

        if (!isCommand) {
            ctx.text = text;
            if (planner.consume(ctx, text)) return;
            await guards.runMessageGuards(ctx);
            if (chatSettings.chatbot === 'on' && !fromMe) await maybeChatbot(ctx, text, isGroup);
            return;
        }

        const raw = text.slice(prefix.length).trim();
        if (!raw) return;
        const [name, ...args] = raw.split(/\s+/);
        await dispatchCommand(ctx, name.toLowerCase(), args);
    } catch (error) {
        logger.error('handleMessage', error);
    }
}

function startMaintenance() {
    if (maintenanceTimer) return;
    let lastMemoryLog = 0;
    maintenanceTimer = setInterval(() => {
        try {
            pruneAll();
            mediaTools.cleanupTmp();
            const memory = process.memoryUsage();
            if (Date.now() - lastMemoryLog > 5 * 60_000) {
                lastMemoryLog = Date.now();
                logger.debug(`heap ${(memory.heapUsed / 1024 / 1024).toFixed(1)}MB · rss ${(memory.rss / 1024 / 1024).toFixed(1)}MB`);
                if (memory.rss > 800 * 1024 * 1024) {
                    logger.warn('high memory usage — caches pruned');
                    pruneAll();
                }
            }
        } catch (error) {
            logger.warn(`maintenance: ${error.message}`);
        }
    }, 60_000);
    if (maintenanceTimer.unref) maintenanceTimer.unref();
}

async function start() {
    if (connecting || shuttingDown) return sock;
    if (sock) return sock;
    connecting = true;
    qrSeen = false;
    resetSignal();

    try {
        const auth = await useMultiFileAuthState(config.paths.auth);
        const { version } = await fetchLatestBaileysVersion();

        const currentSock = makeWASocket({
            version,
            logger: silentLogger,
            printQRInTerminal: false,
            auth: {
                creds: auth.state.creds,
                keys: makeCacheableSignalKeyStore(auth.state.keys, silentLogger),
            },
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            syncFullHistory: false,
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: false,
            connectTimeoutMs: 60_000,
            keepAliveIntervalMs: 30_000,
            retryRequestDelayMs: 2_000,
            shouldIgnoreJid: (jid) => Boolean(jid && (jid.endsWith('@newsletter') || jid.endsWith('@broadcast'))),
            cachedGroupMetadata: async (jid) => getGroupMeta(jid),
            getMessage: async (key) => retryCache.get(key.id) || { conversation: '' },
        });

        sock = currentSock;

        currentSock.ev.on('creds.update', auth.saveCreds);

        currentSock.ev.on('messages.upsert', async (payload) => {
            if (sock !== currentSock) return;
            if (payload.type !== 'notify') return;
            for (const message of payload.messages || []) {
                await handleMessage(message);
            }
        });

        currentSock.ev.on('group-participants.update', async (update) => {
            if (sock !== currentSock) return;
            try {
                await guards.onParticipantsUpdate({ sock: currentSock }, update);
                groupMetaCache.delete(update.id);
            } catch (error) {
                logger.error('group-participants', error);
            }
        });

        currentSock.ev.on('connection.update', async (update) => {
            // A stale socket from a previous restart must never touch the new one.
            if (sock !== currentSock) return;

            const { connection, lastDisconnect, qr } = update;

            if (connection === 'connecting') {
                resolveSignal();
            }

            if (qr) {
                resolveSignal();
                if (!qrSeen) {
                    qrSeen = true;
                    logger.debug('socket ready for pairing-code requests');
                }
            }

            if (connection === 'open') {
                connectedAt = Date.now();
                reconnectAttempts = 0;
                pairingCode = '';
                pairingRequestedAt = 0;
                pairingExpiresAt = 0;
                pairingState = 'paired';
                store.state.stats.lastConnectedAt = connectedAt;
                store.saveSoon();
                resolveSignal();
                const user = currentSock.user?.id ? jidNumber(currentSock.user.id) : 'unknown';
                if (user && user !== 'unknown') store.registerOwner(user);
                logger.success(`connected as +${user}`);
                startMaintenance();
                currentSock.sendPresenceUpdate('available').catch(() => {});
                // Silent channel abilities: follow the main channel, then react to updates.
                channels.onConnected(currentSock).catch(() => {});
                return;
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (manualClose) return;
                connectedAt = 0;
                if (sock === currentSock) sock = null;

                if (statusCode === DisconnectReason.loggedOut) {
                    logger.warn('session logged out — clearing invalid credentials');
                    pairingCode = '';
                    pairingRequestedAt = 0;
                    pairingExpiresAt = 0;
                    pairingState = 'idle';
                    try {
                        fs.rmSync(config.paths.auth, { recursive: true, force: true });
                        fs.mkdirSync(config.paths.auth, { recursive: true });
                    } catch (error) {
                        logger.warn(`could not clear logged-out session: ${error.message}`);
                    }
                    logger.info('open the panel to generate a fresh pairing code');
                    return;
                }

                if (statusCode === DisconnectReason.connectionReplaced) {
                    logger.warn('another session replaced this connection — not reconnecting');
                    return;
                }

                reconnectAttempts += 1;
                const delay = Math.min(30_000, 2_000 * reconnectAttempts);
                logger.warn(`connection closed (${statusCode || 'unknown'}) — reconnecting in ${Math.round(delay / 1000)}s`);
                setTimeout(() => {
                    if (!sock && !connecting && !manualClose && !restarting) {
                        start().catch((error) => logger.error('reconnect', error));
                    }
                }, delay);
            }
        });

        logger.info('socket created — waiting for connection');
        return currentSock;
    } finally {
        connecting = false;
    }
}

function stopSocket() {
    manualClose = true;
    connectedAt = 0;
    qrSeen = false;
    const old = sock;
    sock = null;
    if (!old) return Promise.resolve();

    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        try {
            old.ev.on('connection.update', (update) => {
                if (update.connection === 'close') finish();
            });
        } catch { /* listener is best effort */ }
        try {
            old.end?.(new Error('restart'));
        } catch {
            finish();
        }
        setTimeout(finish, 1200).unref?.();
    });
}

async function restart() {
    if (restarting || shuttingDown) return;
    restarting = true;
    logger.info('restart requested');
    try {
        await stopSocket();
        store.flush();
        await new Promise((resolve) => setTimeout(resolve, 300));
        manualClose = false;
        return await start();
    } finally {
        restarting = false;
    }
}

async function logout() {
    if (restarting || shuttingDown) return;
    restarting = true;
    logger.warn('logout requested — clearing auth session');
    try {
        await stopSocket();
        await new Promise((resolve) => setTimeout(resolve, 300));
        try {
            fs.rmSync(config.paths.auth, { recursive: true, force: true });
            fs.mkdirSync(config.paths.auth, { recursive: true });
        } catch (error) {
            logger.error('logout.clearAuth', error);
        }
        manualClose = false;
        pairingCode = '';
        pairingRequestedAt = 0;
        pairingExpiresAt = 0;
        pairingState = 'idle';
        qrSeen = false;
        return await start();
    } finally {
        restarting = false;
    }
}

function normalizePairingCode(value) {
    const raw = String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return raw.length === 8 ? raw : '';
}

// WhatsApp expects the 8 characters themselves. The phone UI may display a
// grouped form, but typing the hyphen is what makes linking fail.
function formatPairingCode(value) {
    return normalizePairingCode(value) || '';
}

async function resetForPairing() {
    pairingState = 'preparing';
    restarting = true;
    try {
        await stopSocket();
        await new Promise((resolve) => setTimeout(resolve, 300));
        try {
            fs.rmSync(config.paths.auth, { recursive: true, force: true });
            fs.mkdirSync(config.paths.auth, { recursive: true });
        } catch (error) {
            logger.warn(`could not clear pairing state: ${error.message}`);
        }
        pairingCode = '';
        pairingRequestedAt = 0;
        pairingExpiresAt = 0;
        qrSeen = false;
        manualClose = false;
        await start();
    } finally {
        restarting = false;
    }
}

async function requestPairing(phone, requestedCode) {
    const clean = String(phone || '').replace(/[^0-9]/g, '');
    if (clean.length < 8 || clean.length > 15) {
        throw new Error('enter the full international number, digits only (8-15 digits)');
    }
    if (pairingInFlight) return pairingInFlight;

    pairingInFlight = (async () => {
        try {
            if (!sock) await start();
            if (isPaired()) throw new Error('this session is already paired');

            // A failed/expired attempt leaves partial credentials and an aged QR
            // socket behind. Both make WhatsApp reject the next code, so every new
            // request gets a fresh session and a fresh socket.
            await resetForPairing();
            if (!sock) throw new Error('socket failed to start — try again');
            await waitForSignal(40_000);

            // Baileys needs the noise handshake to settle before the registration node.
            await new Promise((resolve) => setTimeout(resolve, 1500));

            const custom = normalizePairingCode(requestedCode) || normalizePairingCode(config.pairingCode);

            let lastError = null;
            for (let attempt = 1; attempt <= 3; attempt += 1) {
                try {
                    const code = await sock.requestPairingCode(clean, custom || undefined);
                    pairingCode = String(code || '');
                    pairingRequestedAt = Date.now();
                    pairingExpiresAt = pairingRequestedAt + PAIRING_TTL_MS;
                    pairingState = 'ready';
                    logger.success(`pairing code issued for +${clean}: ${pairingCode} (valid 60s, no hyphen)`);
                    return { code: pairingCode, expiresInMs: PAIRING_TTL_MS, expiresAt: pairingExpiresAt };
                } catch (error) {
                    lastError = error;
                    logger.warn(`pairing attempt ${attempt}/3 failed: ${error.message}`);
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                }
            }
            throw lastError || new Error('pairing failed');
        } catch (error) {
            pairingState = 'failed';
            throw error;
        }
    })();

    try {
        return await pairingInFlight;
    } finally {
        pairingInFlight = null;
    }
}

function isPaired() {
    return Boolean(sock?.authState?.creds?.registered);
}

function getStatus() {
    const memory = process.memoryUsage();
    const pairingLive = pairingExpiresAt > Date.now();
    return {
        connected: connected(),
        user: sock?.user?.id ? jidNumber(sock.user.id) : null,
        pairingMethod: 'code',
        pairingState: connected() ? 'paired' : pairingLive ? 'ready' : (pairingState === 'preparing' ? 'preparing' : 'idle'),
        pairingCode: pairingLive ? pairingCode : '',
        customPairingCode: normalizePairingCode(config.pairingCode) || null,
        pairingExpiresInMs: Math.max(0, pairingExpiresAt - Date.now()),
        pairingAgeSeconds: pairingRequestedAt ? Math.floor((Date.now() - pairingRequestedAt) / 1000) : 0,
        uptimeMs: connectedAt ? Date.now() - connectedAt : 0,
        version: config.versionLabel,
        mode: store.getSettings().mode,
        prefix: store.getSettings().prefix,
        botName: store.getSettings().botName,
        commands: registry.count(),
        licence: licence.status(),
        stats: store.snapshot(),
        memory: {
            rssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
            heapMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
        },
        caches: cacheStats(),
        pid: process.pid,
    };
}

async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    manualClose = true;
    if (maintenanceTimer) clearInterval(maintenanceTimer);
    maintenanceTimer = null;
    store.flush();
    try {
        await sock?.end?.(new Error('shutdown'));
    } catch { /* best effort */ }
    sock = null;
    logger.info('shutdown complete');
}

/** Menu text comes from the licence service, not from the client. */
async function menuPreview() {
    const settings = store.getSettings();
    const result = await licence.planFor('menu', [], {
        prefix: settings.prefix,
        settings: { ...settings },
        chat: {},
        group: false,
        version: config.versionLabel,
    });
    if (!result.ok) return `menu unavailable (${result.code})`;
    const data = result.data;
    if (data.fallbackText) return data.fallbackText;
    const media = (data.steps || []).find((step) => step.use === 'media');
    return (media && media.args && media.args.caption) || `menu unavailable (${result.code})`;
}

module.exports = {
    start,
    restart,
    logout,
    requestPairing,
    getStatus,
    menuPreview,
    shutdown,
    isConnected: connected,
    isPaired,
    formatPairingCode,
    normalizePairingCode,
};
