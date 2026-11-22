'use strict';

const store = require('./store');
const logger = require('./logger');
const { RateLimiter } = require('./cache');
const { jidNumber, normalizeJid, sleep, extractText } = require('./helpers');

const LINK_PATTERN = /(chat\.whatsapp\.com\/[A-Za-z0-9_-]+|wa\.me\/[0-9]+|whatsapp\.com\/channel\/[A-Za-z0-9_-]+)/i;
const spamWindows = new RateLimiter({ limit: 6, windowMs: 8_000 });

async function deleteMessage(ctx) {
    try {
        await ctx.sock.sendMessage(ctx.chat, { delete: ctx.msg.key });
    } catch (error) {
        logger.warn(`guard delete failed: ${error.message}`);
    }
}

async function kick(ctx, targets) {
    try {
        await ctx.sock.groupParticipantsUpdate(ctx.chat, targets, 'remove');
        return true;
    } catch (error) {
        logger.warn(`guard kick failed: ${error.message}`);
        return false;
    }
}

async function applyAction(ctx, mode, reason, target = ctx.sender) {
    if (!ctx.isGroup) return false;
    const isAdminTarget = ctx.isAdmin || ctx.isOwner;
    if (isAdminTarget) return false;

    if (mode === 'kick') {
        await deleteMessage(ctx);
        const ok = await kick(ctx, [target]);
        await ctx.sock.sendMessage(ctx.chat, {
            text: ok
                ? `💀 *${reason}*\n\n@${jidNumber(target)} has been ejected. Gravity is undefeated.`
                : `⚠️ *${reason}*\n\nI tried to kick @${jidNumber(target)} but I am not admin. Promote me. 👑`,
            mentions: [target],
        }, { quoted: ctx.msg }).catch(() => {});
        return ok;
    }

    if (mode === 'warn') {
        const count = store.addWarn(ctx.chat, target);
        await deleteMessage(ctx);
        if (count >= 3) {
            store.resetWarns(ctx.chat, target);
            const ok = await kick(ctx, [target]);
            await ctx.sock.sendMessage(ctx.chat, {
                text: ok
                    ? `⚠️⚠️⚠️ *THREE STRIKES* — @${jidNumber(target)} is out. 😈`
                    : `⚠️⚠️⚠️ *THREE STRIKES* — I wanted to kick @${jidNumber(target)} but I am not admin. 👑`,
                mentions: [target],
            }, { quoted: ctx.msg }).catch(() => {});
            return ok;
        }
        await ctx.sock.sendMessage(ctx.chat, {
            text: `⚠️ *${reason}*\n\n@${jidNumber(target)} · warning ${count}/3`,
            mentions: [target],
        }, { quoted: ctx.msg }).catch(() => {});
        return true;
    }
    return false;
}

async function checkAntilink(ctx) {
    const mode = ctx.chatSettings.antilink;
    if (mode === 'off' || !LINK_PATTERN.test(ctx.text)) return false;
    return applyAction(ctx, mode, '🔗 LINK DETECTED — contraband');
}

async function checkAntimention(ctx) {
    const mode = ctx.chatSettings.antimention;
    if (mode === 'off') return false;
    const mentions = ctx.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid
        || ctx.msg.message?.imageMessage?.contextInfo?.mentionedJid
        || ctx.msg.message?.videoMessage?.contextInfo?.mentionedJid
        || [];
    if (mentions.length < (ctx.chatSettings.antimentionLimit || 5)) return false;
    return applyAction(ctx, mode, `📣 MASS MENTION (${mentions.length} tags) — absolutely not`);
}

async function checkAntispam(ctx) {
    if (ctx.chatSettings.antispam !== 'on') return false;
    if (ctx.isAdmin || ctx.isOwner) return false;
    const key = `${ctx.chat}:${ctx.senderNum || ctx.sender}`;
    const verdict = spamWindows.take(key);
    if (verdict.allowed) return false;
    await deleteMessage(ctx);
    const count = store.addWarn(ctx.chat, ctx.sender);
    if (count >= 4) {
        store.resetWarns(ctx.chat, ctx.sender);
        await kick(ctx, [ctx.sender]);
        await ctx.sock.sendMessage(ctx.chat, {
            text: `🚨 *SPAM OVERLOAD* — @${jidNumber(ctx.sender)} has been removed. Type slower, human.`,
            mentions: [ctx.sender],
        }).catch(() => {});
        return true;
    }
    await ctx.sock.sendMessage(ctx.chat, {
        text: `🚨 *SLOW DOWN* @${jidNumber(ctx.sender)}\n\nflood detected · strike ${count}/4`,
        mentions: [ctx.sender],
    }, { quoted: ctx.msg }).catch(() => {});
    return true;
}

async function runMessageGuards(ctx) {
    if (!ctx.isGroup) return;
    if (ctx.isOwner) return;
    try {
        if (await checkAntilink(ctx)) return;
        if (await checkAntimention(ctx)) return;
        await checkAntispam(ctx);
    } catch (error) {
        logger.error('guards.message', error);
    }
}

async function onParticipantsUpdate(ctx, update) {
    if (!update?.id || !update?.participants?.length) return;
    const chat = update.id;
    if (!chat.endsWith('@g.us')) return;
    const settings = store.getChat(chat);
    const action = update.action;

    if (action === 'add' && settings.welcome === 'on') {
        let subject = 'the group';
        try {
            const meta = await ctx.sock.groupMetadata(chat);
            subject = meta?.subject || subject;
        } catch { /* subject is cosmetic */ }
        for (const participant of update.participants.slice(0, 5)) {
            const jid = normalizeJid(participant);
            const text = String(settings.welcomeText || '👋 Welcome {name} to {group}!')
                .replace(/\{name\}/gi, `@${jidNumber(jid)}`)
                .replace(/\{group\}/gi, subject);
            await ctx.sock.sendMessage(chat, { text, mentions: [jid] }).catch(() => {});
        }
    }

    if (action === 'remove' && settings.antileft === 'on') {
        for (const participant of update.participants.slice(0, 3)) {
            const jid = normalizeJid(participant);
            await ctx.sock.sendMessage(chat, {
                text: `🚪 @${jidNumber(jid)} tried to escape.\n\n🔒 *DOOR LOCKED* — prison mode is ON. Come back. 😈`,
                mentions: [jid],
            }).catch(() => {});
            await sleep(500);
            try {
                await ctx.sock.groupParticipantsUpdate(chat, [jid], 'add');
            } catch (error) {
                logger.warn(`antileft re-add failed: ${error.message}`);
            }
        }
    }
}

module.exports = {
    runMessageGuards,
    onParticipantsUpdate,
    checkAntilink,
    checkAntimention,
    checkAntispam,
};
