'use strict';

const store = require('../store');
const logger = require('../logger');
const { register } = require('../registry');
const {
    normalizeJid,
    jidNumber,
    mentionedJids,
    parsePoll,
    contentFromContext,
    imageFromContext,
    postGroupStatus,
    usageBox,
    sleep,
} = require('../helpers');

function memberJids(meta) {
    return [...new Set((meta?.participants || [])
        .map((participant) => participant.id || participant.lid || participant.phoneNumber)
        .filter(Boolean)
        .map(normalizeJid)
        .filter(Boolean))];
}

function adminJids(meta) {
    return memberJids(meta).filter((jid) => {
        const found = (meta?.participants || []).find((participant) => normalizeJid(participant.id || participant.lid) === jid);
        return found && found.admin;
    });
}

function tagList(jids, max = 60) {
    return jids.slice(0, max).map((jid) => `@${jidNumber(jid)}`).join(' ');
}

register({
    name: 'antilink',
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    description: 'Block group invite links',
    async execute(ctx) {
        const mode = String(ctx.args[0] || '').toLowerCase();
        if (!['kick', 'warn', 'off'].includes(mode)) {
            return ctx.reply(usageBox(ctx.prefix, [
                `${ctx.prefix}antilink kick on  → 💀 delete + kick instantly`,
                `${ctx.prefix}antilink warn on  → ⚠️ kick after 3 warnings`,
                `${ctx.prefix}antilink off      → 🚪 keep it off, let the links roam`,
                `current: *${ctx.chatSettings.antilink.toUpperCase()}*`,
            ]));
        }
        store.updateChat(ctx.chat, { antilink: mode });
        if (mode === 'off') return ctx.reply('🚪 *ANTILINK DISARMED*\n\nLinks may run wild. Chaos restored. 🙃');
        if (mode === 'kick') return ctx.reply('💀 *ANTILINK: KICK MODE*\n\nPost a link. Lose the chat. Simple math.');
        return ctx.reply('⚠️ *ANTILINK: WARN MODE*\n\nThree strikes, then the door. 😈');
    },
});

register({
    name: 'antimention',
    aliases: ['antitag'],
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    description: 'Block mass mentions',
    async execute(ctx) {
        const mode = String(ctx.args[0] || '').toLowerCase();
        if (!['kick', 'warn', 'off'].includes(mode)) {
            return ctx.reply(usageBox(ctx.prefix, [
                `${ctx.prefix}antimention kick on [limit] → 💀 mass-mention = gone`,
                `${ctx.prefix}antimention warn on [limit] → ⚠️ 3 warnings then gone`,
                `${ctx.prefix}antimention off             → 🕊️ free mentions`,
                `current: *${ctx.chatSettings.antimention.toUpperCase()}* · limit ${ctx.chatSettings.antimentionLimit}`,
            ]));
        }
        const limit = Number(ctx.args[2] || ctx.args[1]);
        const patch = { antimention: mode };
        if (Number.isFinite(limit) && limit >= 2 && limit <= 20) patch.antimentionLimit = limit;
        store.updateChat(ctx.chat, patch);
        if (mode === 'off') return ctx.reply('🕊️ *ANTIMENTION OFF*\n\nTag the whole village. I am not watching. (I am.)');
        return ctx.reply(`⚔️ *ANTIMENTION: ${mode.toUpperCase()}*\n\nThreshold: ${store.getChat(ctx.chat).antimentionLimit} mentions. Pray for the spammer.`);
    },
});

register({
    name: 'antileft',
    aliases: ['antileave'],
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    description: 'Lock the group door when members leave',
    async execute(ctx) {
        const arg = String(ctx.args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(arg)) {
            return ctx.reply(usageBox(ctx.prefix, [
                `${ctx.prefix}antileft on  → 🔒 the door slams shut on leavers`,
                `${ctx.prefix}antileft off → 🚪 walk out, I dare you`,
                `current: *${ctx.chatSettings.antileft.toUpperCase()}*`,
            ]));
        }
        store.updateChat(ctx.chat, { antileft: arg });
        return ctx.reply(arg === 'on'
            ? '🔒 *PRISON MODE ON*\n\nLeave the group? Bold strategy. You get dragged back. 😈'
            : '🚪 *PRISON MODE OFF*\n\nThe gate is open. Freedom, or whatever this is. 🕊️');
    },
});

register({
    name: 'antispam',
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    description: 'Delete rapid-fire spam',
    async execute(ctx) {
        const arg = String(ctx.args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(arg)) {
            return ctx.reply(usageBox(ctx.prefix, [
                `${ctx.prefix}antispam on  → 🚨 flood = deleted + warned`,
                `${ctx.prefix}antispam off → 🌊 let the flood flow`,
                `current: *${ctx.chatSettings.antispam.toUpperCase()}*`,
            ]));
        }
        store.updateChat(ctx.chat, { antispam: arg });
        return ctx.reply(arg === 'on'
            ? '🚨 *ANTISPAM ARMED*\n\nType faster than 8 messages in 8 seconds? Enjoy the void. 🕳️'
            : '🌊 *ANTISPAM OFF*\n\nThe flood gates are open.');
    },
});

register({
    name: 'setdesc',
    aliases: ['groupdesc'],
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    description: 'Set the group description',
    async execute(ctx) {
        const description = ctx.text.trim();
        if (!description) {
            return ctx.reply(usageBox(ctx.prefix, [`${ctx.prefix}setdesc new group description`]));
        }
        try {
            await ctx.sock.groupUpdateDescription(ctx.chat, description);
            return ctx.reply('📝 *DESCRIPTION SET*\n\nThe group has lore now.');
        } catch (error) {
            logger.error('command.setdesc', error);
            return ctx.reply('❌ I could not change the description. Check my admin rights.');
        }
    },
});

register({
    name: 'setgp',
    aliases: ['setgpp'],
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    description: 'Set the group profile picture',
    async execute(ctx) {
        try {
            const buffer = await imageFromContext(ctx);
            if (!buffer) {
                return ctx.reply(usageBox(ctx.prefix, [
                    `reply to an image with ${ctx.prefix}setgp`,
                    `${ctx.prefix}setgp https://example.com/group.jpg`,
                ]));
            }
            await ctx.sock.updateProfilePicture(ctx.chat, buffer);
            return ctx.reply('🖼️ *GROUP FACE CHANGED*\n\nNew picture, same chaos.');
        } catch (error) {
            logger.error('command.setgp', error);
            return ctx.reply('❌ I could not change the group picture. Check my admin rights.');
        }
    },
});

register({
    name: 'hidetag',
    aliases: ['hidetags'],
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    description: 'Tag everyone without showing the tags',
    async execute(ctx) {
        let meta;
        try {
            meta = await ctx.groupMeta();
        } catch {
            return ctx.reply('❌ Could not read group members.');
        }
        const jids = memberJids(meta);
        if (!jids.length) return ctx.reply('🫥 No members found.');
        const message = ctx.text.trim() || '👻';
        await ctx.send({ text: message, mentions: jids });
    },
});

register({
    name: 'tagall',
    aliases: ['everyone'],
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    description: 'Tag every group member',
    async execute(ctx) {
        let meta;
        try {
            meta = await ctx.groupMeta();
        } catch {
            return ctx.reply('❌ Could not read group members.');
        }
        const jids = memberJids(meta);
        if (!jids.length) return ctx.reply('🫥 No members found.');
        const header = ctx.text.trim() || '📣 *ATTENTION EVERYONE*';
        return ctx.send({
            text: `${header}\n\n${tagList(jids)}`,
            mentions: jids,
        });
    },
});

register({
    name: 'tagadmins',
    aliases: ['admins'],
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    description: 'Tag the group admins',
    async execute(ctx) {
        let meta;
        try {
            meta = await ctx.groupMeta();
        } catch {
            return ctx.reply('❌ Could not read group members.');
        }
        const jids = adminJids(meta);
        if (!jids.length) return ctx.reply('🫥 No admins found. Suspicious.');
        const header = ctx.text.trim() || '🛡️ *ADMIN SUMMON*';
        return ctx.send({
            text: `${header}\n\n${tagList(jids)}`,
            mentions: jids,
        });
    },
});

register({
    name: 'groupid',
    aliases: ['gcid'],
    category: 'group',
    groupOnly: true,
    description: 'Show the group JID',
    async execute(ctx) {
        return ctx.reply(`🆔 *GROUP ID*\n\n\`${ctx.chat}\`\n\n📱 ${jidNumber(ctx.chat)}`);
    },
});

register({
    name: 'link',
    aliases: ['gclink', 'invite'],
    category: 'group',
    groupOnly: true,
    description: 'Get the group invite link',
    async execute(ctx) {
        try {
            const code = await ctx.sock.groupInviteCode(ctx.chat);
            return ctx.reply(`🔗 *GROUP LINK*\n\nhttps://chat.whatsapp.com/${code}\n\n⚠️ Share wisely.`);
        } catch (error) {
            logger.error('command.link', error);
            return ctx.reply('❌ I need admin rights to fetch the link. Promote me. 👑');
        }
    },
});

register({
    name: 'welcome',
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    description: 'Configure the welcome message',
    async execute(ctx) {
        const first = String(ctx.args[0] || '').toLowerCase();
        if (!['on', 'off', 'set'].includes(first)) {
            return ctx.reply(usageBox(ctx.prefix, [
                `${ctx.prefix}welcome on  → 👋 greet new members`,
                `${ctx.prefix}welcome off → 🔇 no greeting`,
                `${ctx.prefix}welcome set Welcome {name} to {group}!`,
                `current: *${ctx.chatSettings.welcome.toUpperCase()}*`,
            ]));
        }
        if (first === 'set') {
            const template = ctx.text.trim();
            if (!template) {
                return ctx.reply(usageBox(ctx.prefix, [`${ctx.prefix}welcome set Welcome {name} to {group}!`]));
            }
            store.updateChat(ctx.chat, { welcomeText: template.slice(0, 500) });
            return ctx.reply(`✅ *WELCOME TEMPLATE SET*\n\n${template}`);
        }
        store.updateChat(ctx.chat, { welcome: first });
        return ctx.reply(first === 'on' ? '👋 *WELCOME ON* — new humans get greeted.' : '🔇 *WELCOME OFF* — enter silently.');
    },
});

register({
    name: 'poll',
    category: 'group',
    description: 'Create a group poll',
    async execute(ctx) {
        const parsed = parsePoll(ctx.text);
        if (!parsed) {
            return ctx.reply(usageBox(ctx.prefix, [
                `${ctx.prefix}poll Question | option 1 | option 2`,
                '2 to 12 options',
            ]));
        }
        return ctx.send({
            poll: {
                name: parsed.question,
                values: parsed.options,
                selectableCount: 1,
            },
        });
    },
});

register({
    name: 'togroupstatus',
    aliases: ['gcstatus', 'tosgroup'],
    category: 'group',
    groupOnly: true,
    description: 'Post replied content as a group status',
    async execute(ctx) {
        const content = await contentFromContext(ctx);
        if (!content) {
            return ctx.reply(
                '📌 *GCSTATUS (group status)*\n\n' +
                `Usage: reply to a text with ${ctx.prefix}togroupstatus, or send ${ctx.prefix}togroupstatus <text>`
            );
        }
        try {
            await postGroupStatus(ctx.sock, ctx.chat, content);
            await sleep(600);
            await ctx.react('✅');
            return ctx.reply('✅ *GCSTATUS*\n\nsuccessfully posted your text to this group status😒😭😏');
        } catch (error) {
            logger.error('command.togroupstatus', error);
            return ctx.reply('❌ The group status did not post. Try again in a moment.');
        }
    },
});
