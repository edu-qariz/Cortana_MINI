'use strict';

const { TTLMap } = require('../cache');
const logger = require('../logger');
const { register } = require('../registry');
const { sleep, resolveTarget, mentionedJids, jidNumber, usageBox } = require('../helpers');

const cooldowns = new TTLMap({ ttlMs: 90_000, max: 500, name: 'prankCooldown' });

// One message is sent, then edited through every stage. This keeps the prank
// to a single bubble instead of flooding the chat.
async function runEditSequence(ctx, frames, { pause = 1200, jitter = 600 } = {}) {
    const sent = await ctx.send({ text: frames[0] });
    const key = sent?.key;
    if (!key) return;

    await ctx.react('💀').catch(() => {});
    let canEdit = true;

    for (let index = 1; index < frames.length; index += 1) {
        await sleep(pause + Math.floor(Math.random() * jitter));
        try {
            await ctx.sock.sendMessage(ctx.chat, { text: frames[index], edit: key });
            logger.debug(`prank stage ${index + 1}/${frames.length}`);
        } catch (error) {
            canEdit = false;
            logger.warn(`prank edit failed: ${error.message}`);
            break;
        }
    }

    if (!canEdit) {
        await ctx.send({ text: frames[frames.length - 1] }).catch(() => {});
    }
    await ctx.react('☠️').catch(() => {});
}

register({
    name: 'hackall',
    aliases: ['grouphack'],
    category: 'pranks',
    groupOnly: true,
    description: 'Theatrical group hack simulation (prank)',
    async execute(ctx) {
        if (cooldowns.get(ctx.chat)) {
            return ctx.reply('⏳ The mainframe is still cooling down. Try again in a minute.');
        }
        cooldowns.set(ctx.chat, true);

        let count = 0;
        try {
            const meta = await ctx.groupMeta();
            count = meta?.participants?.length || 0;
        } catch { /* count is cosmetic */ }

        await runEditSequence(ctx, [
            `🛰️ [1/6] scanning group mesh… ${count || '??'} devices online`,
            '🔓 [2/6] handshake accepted · 27 ghost proxies routed',
            '💉 [3/6] injecting payload… ▓▓▓▓▓░░░░░ 47%',
            '💉 [4/6] injecting payload… ▓▓▓▓▓▓▓▓▓░ 93%',
            '🔥 [5/6] puppeting sessions… all devices responding',
            `☠️ [6/6] GROUP COMPROMISED — ${count || 'all'} devices under my control.\n\n` +
            'i can read your chats. i can see your screen.\n' +
            'do not close WhatsApp. do not type. do not breathe.\n\n' +
            'your admin is next. 😈',
        ], { pause: 1300 });
    },
});

register({
    name: 'hijacknum',
    aliases: ['hijack'],
    category: 'pranks',
    description: 'Theatrical number hijack simulation (prank)',
    async execute(ctx) {
        const target = resolveTarget(ctx.msg, ctx.chat, ctx.text, mentionedJids(ctx.msg.message));
        if (!target) {
            return ctx.reply(usageBox(ctx.prefix, [
                `${ctx.prefix}hijacknum @user`,
                `${ctx.prefix}hijacknum 254712345678`,
            ]));
        }
        const key = `${ctx.chat}:${target}`;
        if (cooldowns.get(key)) {
            return ctx.reply('⏳ That number is still rebooting. Give it a minute.');
        }
        cooldowns.set(key, true);

        await runEditSequence(ctx, [
            `📡 [1/5] target acquired → +${jidNumber(target)}`,
            '🔐 [2/5] negotiating SIM handshake… 3 attempts',
            '📲 [3/5] intercepting OTP stream… ▓▓▓▓▓░░░░ 52%',
            '🧬 [4/5] cloning session fingerprint… ▓▓▓▓▓▓▓▓ 88%',
            `☠️ [5/5] HIJACK COMPLETE — +${jidNumber(target)}\n\n` +
            'session cloned. device mirrored. OTP stream open.\n' +
            'i am reading their messages right now.\n' +
            'they will never know it was you. 😈',
        ], { pause: 1200 });
    },
});
