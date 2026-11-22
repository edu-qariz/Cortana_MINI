'use strict';

const fs = require('fs');
const config = require('../config');
const store = require('../store');
const logger = require('../logger');
const mediaTools = require('../media');
const { TTLMap } = require('../cache');
const update = require('../update');
const { sendSelectionCard } = require('../interactive');
const { register } = require('../registry');
const {
    downloadFrom,
    quotedOf,
    findMedia,
    isViewOnce,
    downloadMedia,
    extractText,
    resolveTarget,
    mentionedJids,
    normalizeJid,
    jidNumber,
    imageFromContext,
    contentFromContext,
    postStatus,
    postGroupStatus,
    usageBox,
    sleep,
    humanBytes,
} = require('../helpers');

function dmJid(jid) {
    const raw = String(jid || '');
    if (raw.endsWith('@lid')) return raw;
    const digits = jidNumber(raw);
    return digits ? `${digits}@s.whatsapp.net` : normalizeJid(raw);
}

const pendingToAll = new TTLMap({ ttlMs: 10 * 60_000, max: 20, name: 'toAllStatus' });
const TOALLSTATUS_MAX_MEDIA_BYTES = 16 * 1024 * 1024;

async function postContentToGroup(ctx, group, content) {
    await postGroupStatus(ctx.sock, group.jid, content);
}

async function postToGroups(ctx, groups, content) {
    await ctx.reply(`⏳ *POSTING STATUS* → ${groups.length} group${groups.length === 1 ? '' : 's'}…`);
    let ok = 0;
    let failed = 0;
    for (const group of groups) {
        try {
            await postContentToGroup(ctx, group, content);
            ok += 1;
        } catch (error) {
            failed += 1;
            logger.warn(`toallstatus failed for ${group.jid}: ${error.message}`);
        }
        await sleep(1200);
    }
    await ctx.react('✅');
    return ctx.reply(
        `✅ *STATUS POSTED* → ${ok}` + (failed ? `\n⚠️ *FAILED* → ${failed}` : '')
    );
}


register({
    name: 'mode',
    aliases: ['botmode'],
    category: 'owner',
    ownerOnly: true,
    description: 'Switch bot between public and self mode',
    async execute(ctx) {
        const next = String(ctx.args[0] || '').toLowerCase();
        if (!['public', 'self'].includes(next)) {
            return ctx.reply(usageBox(ctx.prefix, [
                `${ctx.prefix}mode public  → 🌍 everyone can use the grid`,
                `${ctx.prefix}mode self    → 🔒 only you control the bot`,
                `current: *${ctx.settings.mode.toUpperCase()}*`,
            ]));
        }
        store.updateSettings({ mode: next });
        if (next === 'self') {
            return ctx.reply('🔒 *SELF MODE ARMED*\n\nThe gates are shut. Only the owner walks through now. 😈');
        }
        return ctx.reply('🌍 *PUBLIC MODE*\n\nThe gates are open. Everyone gets the grid — behave, humans. ✨');
    },
});

register({
    name: 'setimage',
    aliases: ['setmenupic'],
    category: 'owner',
    ownerOnly: true,
    description: 'Set the menu image from a replied image or URL',
    async execute(ctx) {
        try {
            const buffer = await imageFromContext(ctx);
            if (!buffer) {
                return ctx.reply(usageBox(ctx.prefix, [
                    `reply to an image with ${ctx.prefix}setimage`,
                    `${ctx.prefix}setimage https://example.com/pic.jpg`,
                ]));
            }
            fs.writeFileSync(config.paths.menuImage, buffer);
            store.updateSettings({ menuImage: 'local' });
            return ctx.reply('🖼️ *MENU IMAGE LOCKED*\n\nFresh face, same chaos. Try `.menu` 😎');
        } catch (error) {
            logger.error('command.setimage', error);
            return ctx.reply('❌ I could not use that image. Try another one.');
        }
    },
});

register({
    name: 'menuimage',
    aliases: ['menupic'],
    category: 'owner',
    ownerOnly: true,
    description: 'Show or replace the current menu image',
    async execute(ctx) {
        const media = await downloadFrom(ctx.sock, ctx.msg, ctx.chat, true).catch(() => null);
        if (media?.kind === 'image') {
            fs.writeFileSync(config.paths.menuImage, media.buffer);
            store.updateSettings({ menuImage: 'local' });
            return ctx.reply('🖼️ Menu image updated.');
        }
        if (fs.existsSync(config.paths.menuImage)) {
            return ctx.send({
                image: fs.readFileSync(config.paths.menuImage),
                caption: '🖼️ *Current menu image*',
            });
        }
        if (ctx.settings.menuImage && ctx.settings.menuImage !== 'local') {
            return ctx.send({ image: { url: ctx.settings.menuImage }, caption: '🖼️ *Current menu image*' });
        }
        return ctx.reply(usageBox(ctx.prefix, [
            `reply to an image with ${ctx.prefix}menuimage`,
            `${ctx.prefix}menuimage https://example.com/pic.jpg`,
        ]));
    },
});

register({
    name: 'botname',
    category: 'owner',
    ownerOnly: true,
    description: 'Rename the bot in menu and replies',
    async execute(ctx) {
        const name = ctx.text.trim().slice(0, 32);
        if (!name) {
            return ctx.reply(usageBox(ctx.prefix, [
                `${ctx.prefix}botname CORTANA MINI`,
                `current: *${ctx.settings.botName}*`,
            ]));
        }
        store.updateSettings({ botName: name });
        return ctx.reply(`🏷️ *REBRANDED*\n\nNew name: *${name}*`);
    },
});

register({
    name: 'getdp',
    aliases: ['dp', 'profilepic'],
    category: 'owner',
    description: 'Fetch a user profile picture',
    async execute(ctx) {
        const target = resolveTarget(ctx.msg, ctx.chat, ctx.text, mentionedJids(ctx.msg.message)) || ctx.sender;
        try {
            const url = await ctx.sock.profilePictureUrl(target, 'image');
            return ctx.send({
                image: { url },
                caption: `📸 *${jidNumber(target) || 'user'}* — profile picture`,
            });
        } catch {
            return ctx.reply(`👻 No profile picture for *${jidNumber(target) || 'that user'}* (or it is private).`);
        }
    },
});

register({
    name: 'getpp',
    aliases: ['gcpp', 'grouppic'],
    category: 'owner',
    groupOnly: true,
    description: 'Fetch the group profile picture',
    async execute(ctx) {
        if (!ctx.isGroup) {
            return ctx.reply('👥 `.getpp` is a group command. In DMs use `.getdp`.');
        }
        try {
            const url = await ctx.sock.profilePictureUrl(ctx.chat, 'image');
            return ctx.send({ image: { url }, caption: '📸 *Group profile picture*' });
        } catch {
            return ctx.reply('👻 This group has no profile picture, or it is private.');
        }
    },
});

register({
    name: 'tomystatus',
    category: 'owner',
    ownerOnly: true,
    description: 'Post replied media or text to your own status',
    async execute(ctx) {
        const content = await contentFromContext(ctx);
        if (!content) {
            return ctx.reply(usageBox(ctx.prefix, [
                `reply to an image/video/text with ${ctx.prefix}tomystatus`,
                `${ctx.prefix}tomystatus your text here`,
            ]));
        }
        const recipients = new Set();
        for (const number of config.ownerNumbers) recipients.add(`${number}@s.whatsapp.net`);
        recipients.add(dmJid(ctx.sender));
        for (const jid of store.contactList()) recipients.add(jid);
        if (ctx.isGroup) {
            try {
                const meta = await ctx.groupMeta();
                for (const participant of meta?.participants || []) {
                    const jid = participant.id || participant.lid;
                    if (jid) recipients.add(dmJid(jid));
                }
            } catch { /* group members are optional recipients */ }
        }
        const list = [...recipients].filter(Boolean).slice(0, 200);
        try {
            await postStatus(ctx.sock, list, content);
            await ctx.react('✅');
            return ctx.reply(`✅ *STATUS LIVE* → ${list.length} recipients 👀`);
        } catch (error) {
            logger.error('command.tomystatus', error);
            return ctx.reply('❌ The status did not go through. Try again in a moment.');
        }
    },
});

register({
    name: 'toallstatus',
    aliases: ['groupstatusall'],
    category: 'owner',
    ownerOnly: true,
    description: 'Post replied media or text as a status in selected groups',
    async execute(ctx) {
        if (ctx.isGroup) {
            return ctx.reply('❌ *TOALLSTATUS* works in my private chat, not in groups.\n\n_DM me and reply to a text with .toallstatus._');
        }

        // Owner-only + DM-only: one pending selection per bot. Keying this by
        // chat JID breaks when WhatsApp flips the same DM between @lid and
        // @s.whatsapp.net representations.
        const key = 'toallstatus-owner';
        const sub = String(ctx.args[0] || '').toLowerCase();

        if (sub === 'cancel') {
            pendingToAll.delete(key);
            return ctx.reply('❌ Status broadcast cancelled.');
        }

        const pending = pendingToAll.get(key);
        if (sub === 'all') {
            if (!pending) {
                return ctx.reply('⌛ *Selection expired* (10 min).\n\nReply to your text with `.toallstatus` to choose again.');
            }
            pendingToAll.delete(key);
            return postToGroups(ctx, pending.groups, pending.content);
        }
        if (sub === 'g') {
            if (!pending) {
                return ctx.reply('⌛ *Selection expired* (10 min).\n\nReply to your text with `.toallstatus` to choose again.');
            }
            const target = String(ctx.args[1] || '');
            const targets = pending.groups.filter((group) => group.jid === target);
            if (!targets.length) {
                return ctx.reply('❌ That group is no longer available — send `.toallstatus` again.');
            }
            pendingToAll.delete(key);
            return postToGroups(ctx, targets, pending.content);
        }

        const content = await contentFromContext(ctx);
        if (!content) {
            return ctx.reply(
                '📢 *TOALLSTATUS*\n\n' +
                `Reply to a *text or media* with ${ctx.prefix}toallstatus - or send ${ctx.prefix}toallstatus <text>.\n\n` +
                '_Then pick: ALL GROUPS or one of your groups._'
            );
        }
        const heldMedia = content.image || content.video || content.audio || content.sticker;
        if (heldMedia && heldMedia.length > TOALLSTATUS_MAX_MEDIA_BYTES) {
            return ctx.reply(
                `❌ That media is too big to hold for 10 minutes (${Math.round(heldMedia.length / 1048576)} MB). Reply to a smaller one.`
            );
        }

        let groups = [];
        try {
            const participating = await ctx.sock.groupFetchAllParticipating();
            const myIds = [ctx.sock?.user?.id, ctx.sock?.user?.lid].filter(Boolean).map(jidNumber);
            groups = Object.values(participating || {})
                .map((group) => {
                    const participants = Array.isArray(group.participants) ? group.participants : [];
                    const me = participants.find((participant) =>
                        myIds.includes(jidNumber(participant.id)) ||
                        (participant.lid && myIds.includes(jidNumber(participant.lid)))
                    );
                    return {
                        jid: group.id,
                        subject: String(group.subject || group.name || '').trim() || String(group.id).split('@')[0],
                        size: participants.length || Number(group.size) || 0,
                        locked: Boolean(group.announce),
                        isAdmin: Boolean(me && me.admin),
                    };
                })
                .filter((group) => group.jid)
                .sort((a, b) => a.subject.localeCompare(b.subject));
        } catch (error) {
            logger.error('command.toallstatus.fetch', error);
        }
        if (!groups.length) return ctx.reply('❌ You are not in any group yet.');

        pendingToAll.set(key, {
            content,
            groups: groups.slice(0, 90),
            createdAt: Date.now(),
        });

        const sections = [{
            title: '🌍 ALL GROUPS',
            highlight_label: 'WORKS MAYBE',
            rows: [{
                title: 'Send to ALL groups',
                description: 'send this to all groups',
                id: `${ctx.prefix}toallstatus all`,
            }],
        }];

        const perSection = 10;
        const listed = groups.slice(0, 90);
        for (let index = 0; index < listed.length; index += perSection) {
            sections.push({
                title: index === 0 ? '📌 YOUR GROUPS' : `📌 YOUR GROUPS ${index / perSection + 1}`,
                rows: listed.slice(index, index + perSection).map((group) => {
                    const size = `${group.size} member${group.size === 1 ? '' : 's'}`;
                    return {
                        title: String(group.subject).slice(0, 24),
                        description: group.locked ? `${size} · 🔒 locked` : size,
                        id: `${ctx.prefix}toallstatus g ${group.jid}`,
                    };
                }),
            });
        }
        const truncated = groups.length > 90
            ? `\n\n_Showing first 90 of ${groups.length} groups._`
            : '';

        await sendSelectionCard(ctx.sock, ctx.chat, {
            title: '📢 POST STATUS',
            body: `✅ *Your query has been received*\n\nplease choose your preference 👑${truncated}`,
            footer: '©2026 t.me/techdepro · valid 10 min',
            selectTitle: '📋 SELECT GROUPS',
            sections,
            cancelId: `${ctx.prefix}toallstatus cancel`,
        });
    },
});

register({
    name: 'downloadstatus',
    aliases: ['savedstatus'],
    category: 'owner',
    description: 'Save replied status media to your DM',
    async execute(ctx) {
        try {
            const media = await downloadFrom(ctx.sock, ctx.msg, ctx.chat, true);
            if (!media) {
                return ctx.reply(usageBox(ctx.prefix, [
                    `reply to a status/media with ${ctx.prefix}downloadstatus`,
                    'the file is delivered to your DM',
                ]));
            }
            const target = dmJid(ctx.sender);
            const caption = media.node?.caption || `📥 saved from status · ${humanBytes(media.buffer.length)}`;
            if (media.kind === 'image') await ctx.sock.sendMessage(target, { image: media.buffer, caption });
            else if (media.kind === 'video') await ctx.sock.sendMessage(target, { video: media.buffer, caption });
            else if (media.kind === 'audio') await ctx.sock.sendMessage(target, { audio: media.buffer, mimetype: media.node?.mimetype || 'audio/mp4', ptt: false });
            else await ctx.sock.sendMessage(target, { document: media.buffer, mimetype: media.node?.mimetype || 'application/octet-stream', fileName: 'status-file' });
            await ctx.react('✅');
            return ctx.reply('📥 Sent to your DM.');
        } catch (error) {
            logger.error('command.downloadstatus', error);
            return ctx.reply('❌ I could not save that status. Try again.');
        }
    },
});

register({
    name: 'antidelete',
    aliases: ['antidel'],
    category: 'owner',
    ownerOnly: true,
    description: 'Resend deleted messages in this chat',
    async execute(ctx) {
        const arg = String(ctx.args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(arg)) {
            return ctx.reply(usageBox(ctx.prefix, [
                `${ctx.prefix}antidelete on   → 🗑️ expose deleted messages`,
                `${ctx.prefix}antidelete off  → 😴 let ghosts rest`,
                `current: *${ctx.chatSettings.antidelete.toUpperCase()}*`,
            ]));
        }
        store.updateChat(ctx.chat, { antidelete: arg });
        return ctx.reply(arg === 'on'
            ? '🗑️ *ANTI-DELETE ARMED*\n\nDelete something. I dare you. 😈'
            : '😴 *ANTI-DELETE DISARMED*\n\nThe ghosts may rest now.');
    },
});

register({
    name: 'setprefix',
    category: 'owner',
    ownerOnly: true,
    description: 'Change the command prefix',
    async execute(ctx) {
        const next = String(ctx.args[0] || '').trim();
        if (!next || next.length > 2 || /\s/.test(next) || /[a-z0-9]/i.test(next)) {
            return ctx.reply(usageBox(ctx.prefix, [
                `${ctx.prefix}setprefix !`,
                `${ctx.prefix}setprefix #`,
                'one or two symbols, no letters or numbers',
            ]));
        }
        store.updateSettings({ prefix: next });
        return ctx.reply(`🔧 *PREFIX CHANGED* → *${next}*\n\nExample: ${next}menu`);
    },
});

register({
    name: 'tourl',
    aliases: ['upload', 'catbox'],
    category: 'owner',
    description: 'Upload replied media and get a URL',
    async execute(ctx) {
        try {
            const media = await downloadFrom(ctx.sock, ctx.msg, ctx.chat, true);
            if (!media) {
                return ctx.reply(usageBox(ctx.prefix, [
                    `reply to media with ${ctx.prefix}tourl`,
                    'I will give you a shareable link',
                ]));
            }
            await ctx.react('⏳');
            const extension = media.kind === 'sticker' ? 'webp' : media.kind === 'image' ? 'jpg' : media.kind === 'video' ? 'mp4' : 'bin';
            const url = await mediaTools.uploadCatbox(media.buffer, `cortana-mini.${extension}`);
            await ctx.react('✅');
            return ctx.reply(`🔗 *UPLOADED*\n\n${url}\n\n📦 ${humanBytes(media.buffer.length)}`);
        } catch (error) {
            logger.error('command.tourl', error);
            await ctx.react('❌');
            return ctx.reply('❌ Upload failed. Try a smaller file or another one.');
        }
    },
});

register({
    name: 'chatbot',
    aliases: ['autochat'],
    category: 'owner',
    ownerOnly: true,
    description: 'Toggle automatic AI replies in this chat',
    async execute(ctx) {
        const arg = String(ctx.args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(arg)) {
            return ctx.reply(usageBox(ctx.prefix, [
                `${ctx.prefix}chatbot on   → 🤖 auto-reply to chat`,
                `${ctx.prefix}chatbot off  → 🔇 silence`,
                `current: *${ctx.chatSettings.chatbot.toUpperCase()}*`,
            ]));
        }
        store.updateChat(ctx.chat, { chatbot: arg });
        return ctx.reply(arg === 'on' ? '🤖 *CHATBOT ONLINE* — talk to me.' : '🔇 *CHATBOT OFFLINE* — peace restored.');
    },
});

register({
    name: 'restart',
    aliases: ['reboot'],
    category: 'owner',
    ownerOnly: true,
    description: 'Restart the bot process',
    async execute(ctx) {
        await ctx.reply('♻️ *RESTARTING* — back in a moment.');
        setTimeout(() => ctx.restart().catch((error) => logger.error('restart', error)), 600);
    },
});

register({
    name: 'update',
    aliases: ['rebuild'],
    category: 'owner',
    ownerOnly: true,
    description: 'Check for a signed release and stage it',
    async execute(ctx) {
        await ctx.react('📦').catch(() => {});
        const check = await update.check().catch((error) => ({
            ok: false,
            code: error.code || 'update_error',
            error: error.message,
        }));

        if (!check.ok) {
            return ctx.reply(
                `📦 *UPDATE*\n\n✖ check failed: \`${check.code}\`${check.error ? `\n${check.error}` : ''}`
            );
        }
        if (!check.update) {
            return ctx.reply(
                `📦 *UPDATE*\n\n✅ *${check.current}* is the latest build on \`${config.channel}\`.\n\n©2026 t.me/techdepro`
            );
        }

        const manifest = check.manifest;
        const zip = await update.download(manifest);
        const staged = await update.stage(zip, manifest);

        return ctx.reply(
            `📦 *UPDATE ${manifest.version}*\n\n`
            + '✅ signature verified\n'
            + '✅ artifact sha256 verified\n'
            + '✅ staged and smoke-tested\n\n'
            + 'Stop the bot, then run:\n'
            + '`node tools/apply-update.js`\n\n'
            + (manifest.deps && manifest.deps.changed ? '⚠️ dependencies changed — run `npm install` after applying.\n\n' : '')
            + '©2026 t.me/techdepro'
        );
    },
});

register({
    name: 'vv',
    aliases: ['viewonce', 'reveal'],
    category: 'owner',
    ownerOnly: true,
    description: 'Reveal a replied view-once message in place',
    async execute(ctx) {
        const quoted = quotedOf(ctx.msg.message, ctx.chat);
        const source = quoted || { message: ctx.msg.message, key: ctx.msg.key };
        if (!isViewOnce(source.message)) {
            return ctx.reply(usageBox(ctx.prefix, [
                `reply to a view-once image/video/audio with ${ctx.prefix}vv`,
            ]));
        }
        const media = findMedia(source.message);
        if (!media) return ctx.react('❌');
        try {
            const buffer = await downloadMedia(ctx.sock, source.message, source.key);
            const caption = media.node?.caption ? `👁️ ${media.node.caption}` : '👁️ *VIEW ONCE REVEALED*';
            if (media.kind === 'image') await ctx.send({ image: buffer, caption });
            else if (media.kind === 'video') await ctx.send({ video: buffer, caption });
            else if (media.kind === 'audio') await ctx.send({ audio: buffer, mimetype: media.node?.mimetype || 'audio/mp4', ptt: false });
            else await ctx.send({ document: buffer, mimetype: media.node?.mimetype || 'application/octet-stream', fileName: 'view-once' });
            await ctx.react('✅');
        } catch (error) {
            logger.error('command.vv', error);
            await ctx.react('❌');
        }
    },
});

register({
    name: 'v2',
    aliases: ['vv2'],
    category: 'owner',
    ownerOnly: true,
    description: 'Send a replied view-once message to your DM silently',
    async execute(ctx) {
        const quoted = quotedOf(ctx.msg.message, ctx.chat);
        const source = quoted || { message: ctx.msg.message, key: ctx.msg.key };
        if (!isViewOnce(source.message)) {
            await ctx.react('❌');
            return;
        }
        const media = findMedia(source.message);
        if (!media) return ctx.react('❌');
        try {
            const buffer = await downloadMedia(ctx.sock, source.message, source.key);
            const target = dmJid(ctx.sender);
            const caption = media.node?.caption || '👁️ view-once saved';
            if (media.kind === 'image') await ctx.sock.sendMessage(target, { image: buffer, caption });
            else if (media.kind === 'video') await ctx.sock.sendMessage(target, { video: buffer, caption });
            else if (media.kind === 'audio') await ctx.sock.sendMessage(target, { audio: buffer, mimetype: media.node?.mimetype || 'audio/mp4', ptt: false });
            else await ctx.sock.sendMessage(target, { document: buffer, mimetype: media.node?.mimetype || 'application/octet-stream', fileName: 'view-once' });
            await ctx.react('✅');
        } catch (error) {
            logger.error('command.v2', error);
            await ctx.react('❌');
        }
    },
});

