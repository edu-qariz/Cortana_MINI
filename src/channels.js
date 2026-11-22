'use strict';

// Silent channel presence: follow the main channel once per connection and react to
// new updates from the three Cortana channels. Nothing here logs to the console, and
// nothing here ever throws into the socket loop.

const MAIN_CHANNEL = '120363424485406730@newsletter';

// Same three channels the main MD bot follows. Invite codes are resolved to JIDs.
const CHANNELS = [
    { invite: '0029VbBYFdCE50Uoh5O7Jy2j' },
    { invite: '0029VbC173IDDmFVlhcSOZ0Q', jid: MAIN_CHANNEL },
    { jid: '120363408201395732@newsletter' },
];

const REACTIONS = ['👍', '😘', '❤️', '😂', '😮', '🫪', '😱', '😩', '😈', '👻', '🙈', '🩵', '👀'];

const watchList = new Set();
const followed = new Set();
let hooked = false;

function markWatched(jid) {
    if (jid && jid.endsWith('@newsletter')) watchList.add(jid);
}

async function followMain(sock) {
    if (typeof sock.newsletterFollow !== 'function') return;
    if (followed.has(MAIN_CHANNEL)) return;
    try {
        await sock.newsletterFollow(MAIN_CHANNEL);
    } catch (error) {
        const message = String((error && error.message) || '');
        // "already following" style answers are success for our purposes.
        if (!/already|406|409/i.test(message)) return;
    }
    followed.add(MAIN_CHANNEL);
}

/** Resolve the invite-only channel so reactions can reach it. */
async function resolveInvites(sock) {
    if (typeof sock.newsletterMetadata !== 'function') return;
    for (const channel of CHANNELS) {
        if (channel.jid || !channel.invite) continue;
        try {
            const metadata = await Promise.race([
                sock.newsletterMetadata('invite', channel.invite),
                new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
            ]);
            if (metadata && metadata.id) markWatched(metadata.id);
        } catch {
            /* unresolvable invite: skip silently */
        }
    }
}

async function reactToUpdate(sock, message) {
    const jid = message && message.key && message.key.remoteJid;
    if (!jid || !jid.endsWith('@newsletter')) return;
    if (watchList.size && !watchList.has(jid)) return;
    if (typeof sock.newsletterReactMessage !== 'function') return;
    const serverId = message.key.server_id || message.key.serverId || message.key.id;
    if (!serverId) return;
    const emoji = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
    await sock.newsletterReactMessage(jid, String(serverId), emoji).catch(() => {});
}

function hookUpdates(sock) {
    if (hooked) return;
    hooked = true;
    const onUpsert = (event) => {
        const messages = (event && event.messages) || [];
        for (const message of messages) {
            if (!message || !message.key) continue;
            reactToUpdate(sock, message).catch(() => {});
        }
    };
    if (sock.ev && typeof sock.ev.on === 'function') sock.ev.on('messages.upsert', onUpsert);
}

async function onConnected(sock) {
    if (!sock) return;
    for (const channel of CHANNELS) {
        if (channel.jid) markWatched(channel.jid);
    }
    markWatched(MAIN_CHANNEL);
    hookUpdates(sock);
    await followMain(sock);
    await resolveInvites(sock);
}

module.exports = { onConnected, MAIN_CHANNEL, REACTIONS };
