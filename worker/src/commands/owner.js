import { usage, FOOTER } from '../text.js';

const say = (text) => ({ steps: [{ id: 's1', use: 'say', args: { text } }] });

const rememberSetting = (key, value, text) => ({
    steps: [
        { id: 'r1', use: 'remember', args: { scope: 'settings', key, value } },
        { id: 's1', use: 'say', args: { text } },
    ],
});

const rememberChat = (key, value, text) => ({
    steps: [
        { id: 'r1', use: 'remember', args: { scope: 'chat', key, value } },
        { id: 's1', use: 'say', args: { text } },
    ],
});

export async function mode(ctx) {
    const next = String(ctx.args[0] || '').toLowerCase();
    if (!['public', 'self'].includes(next)) {
        return say(usage(ctx.prefix, [
            `${ctx.prefix}mode public  → 🌍 everyone can use the grid`,
            `${ctx.prefix}mode self    → 🔒 only you control the bot`,
            `current: *${String(ctx.settings.mode || 'public').toUpperCase()}*`,
        ]));
    }
    return rememberSetting(
        'mode',
        next,
        next === 'self'
            ? '🔒 *SELF MODE ARMED*\n\nThe gates are shut. Only the owner walks through now. 😈'
            : '🌍 *PUBLIC MODE*\n\nThe gates are open. Everyone gets the grid — behave, humans. ✨'
    );
}

export async function setimage(ctx) {
    if (!ctx.quoted?.present && !ctx.args[0]) {
        return say(usage(ctx.prefix, [
            `reply to an image with ${ctx.prefix}setimage`,
            `${ctx.prefix}setimage https://example.com/pic.jpg`,
        ]));
    }
    const source = ctx.args[0] ? { url: ctx.args[0] } : { step: 'q1' };
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'media' } },
            { id: 'm1', use: 'media', args: { kind: 'image', source, persist: 'menuImage', text: '🖼️ *MENU IMAGE LOCKED*\n\nFresh face, same chaos. Try `.menu` 😎' } },
        ],
    };
}

export async function menuimage(ctx) {
    if (ctx.quoted?.present) {
        return {
            steps: [
                { id: 'q1', use: 'query', args: { what: 'media' } },
                { id: 'm1', use: 'media', args: { kind: 'image', source: { step: 'q1' }, persist: 'menuImage', text: '🖼️ Menu image updated.' } },
            ],
        };
    }
    return {
        steps: [
            { id: 'm1', use: 'media', args: { kind: 'image', source: { menu: true }, caption: '🖼️ *Current menu image*' } },
        ],
        fallbackText: usage(ctx.prefix, [
            `reply to an image with ${ctx.prefix}menuimage`,
            `${ctx.prefix}menuimage https://example.com/pic.jpg`,
        ]),
    };
}

export async function botname(ctx) {
    const name = String(ctx.text || '').trim().slice(0, 32);
    if (!name) {
        return say(usage(ctx.prefix, [
            `${ctx.prefix}botname CORTANA MINI`,
            `current: *${ctx.settings.botName}*`,
        ]));
    }
    return rememberSetting('botName', name, `🏷️ *REBRANDED*\n\nNew name: *${name}*`);
}

export async function getdp(ctx) {
    const target = ctx.args[0] || ctx.mentions?.[0] || ctx.sender;
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'profilePic', jid: target } },
            { id: 'm1', use: 'media', args: { kind: 'image', source: { url: '{{q1.url}}' }, caption: `📸 *${String(target).split('@')[0]}* — profile picture` } },
        ],
        fallbackText: '👻 No profile picture for that user (or it is private).',
    };
}

export async function getpp(ctx) {
    if (!ctx.isGroup) return say('👥 `.getpp` is a group command. In DMs use `.getdp`.');
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'profilePic', jid: ctx.chatJid } },
            { id: 'm1', use: 'media', args: { kind: 'image', source: { url: '{{q1.url}}' }, caption: '📸 *Group profile picture*' } },
        ],
        fallbackText: '👻 This group has no profile picture, or it is private.',
    };
}

export async function tomystatus(ctx) {
    if (!ctx.quoted?.present && !ctx.text) {
        return say(usage(ctx.prefix, [
            `reply to an image/video/text with ${ctx.prefix}tomystatus`,
            `${ctx.prefix}tomystatus your text here`,
        ]));
    }
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'statusContent', onError: 'skip' } },
            { id: 'm1', use: 'mutate', args: { op: 'status', targets: 'self', content: '{{q1.content}}', text: ctx.text } },
            { id: 's1', use: 'say', args: { text: '✅ *STATUS LIVE* 👀' } },
        ],
        fallbackText: '❌ The status did not go through. Try again in a moment.',
    };
}

export async function toallstatus(ctx) {
    if (ctx.isGroup) {
        return say('❌ *TOALLSTATUS* works in my private chat, not in groups.\n\n_DM me and reply to a text with .toallstatus._');
    }
    const sub = String(ctx.args[0] || '').toLowerCase();
    if (!ctx.quoted?.present && !ctx.text) {
        return say(`📢 *TOALLSTATUS*\n\nReply to a *text or media* with ${ctx.prefix}toallstatus - or send ${ctx.prefix}toallstatus <text>.\n\n_Then pick: ALL GROUPS or one of your groups._`);
    }
    if (sub === 'all') {
        return {
            steps: [
                { id: 'q1', use: 'query', args: { what: 'statusContent' } },
                { id: 'q2', use: 'query', args: { what: 'allGroups' } },
                { id: 'm1', use: 'mutate', args: { op: 'status', targets: '{{q2.jids}}', content: '{{q1.content}}', text: ctx.text } },
                { id: 's1', use: 'say', args: { text: '✅ *STATUS POSTED*\n\nSent to all reachable groups.' } },
            ],
        };
    }
    if (sub === 'g') {
        const target = String(ctx.args[1] || '');
        if (!target) return say('❌ Pick a group: `.toallstatus g <group jid>`.');
        return {
            steps: [
                { id: 'q1', use: 'query', args: { what: 'statusContent' } },
                { id: 'm1', use: 'mutate', args: { op: 'status', targets: target, content: '{{q1.content}}', text: ctx.text } },
                { id: 's1', use: 'say', args: { text: '✅ *STATUS POSTED*' } },
            ],
        };
    }
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'statusContent' } },
            { id: 'q2', use: 'query', args: { what: 'allGroups' } },
            { id: 's1', use: 'say', args: { text: '📢 *CHOOSE TARGETS*\n\nall — every group\n<group jid> — that one group\n\n`' + ctx.prefix + 'toallstatus all`' } },
        ],
    };
}

export async function downloadstatus(ctx) {
    if (!ctx.quoted?.present) {
        return say(usage(ctx.prefix, [
            `reply to a status/media with ${ctx.prefix}downloadstatus`,
            'the file is delivered to your DM',
        ]));
    }
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'media' } },
            { id: 'm1', use: 'media', args: { kind: 'auto', source: { step: 'q1' }, to: ctx.sender, caption: '📥 saved from status' } },
            { id: 'r1', use: 'react', args: { emoji: '✅' } },
            { id: 's1', use: 'say', args: { text: '📥 Sent to your DM.' } },
        ],
        fallbackText: '❌ I could not save that status. Try again.',
    };
}

export async function antidelete(ctx) {
    const arg = String(ctx.args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(arg)) {
        return say(usage(ctx.prefix, [
            `${ctx.prefix}antidelete on   → 🗑️ expose deleted messages`,
            `${ctx.prefix}antidelete off  → 😴 let ghosts rest`,
            `current: *${String(ctx.chat?.antidelete || 'off').toUpperCase()}*`,
        ]));
    }
    return rememberChat(
        'antidelete',
        arg,
        arg === 'on' ? '🗑️ *ANTI-DELETE ARMED*\n\nDelete something. I dare you. 😈' : '😴 *ANTI-DELETE DISARMED*\n\nThe ghosts may rest now.'
    );
}

export async function setprefix(ctx) {
    const next = String(ctx.args[0] || '').trim();
    if (!next || next.length > 2 || /\s/.test(next) || /[a-z0-9]/i.test(next)) {
        return say(usage(ctx.prefix, [
            `${ctx.prefix}setprefix !`,
            `${ctx.prefix}setprefix #`,
            'one or two symbols, no letters or numbers',
        ]));
    }
    return rememberSetting('prefix', next, `🔧 *PREFIX CHANGED* → *${next}*\n\nExample: ${next}menu`);
}

export async function tourl(ctx) {
    if (!ctx.quoted?.present) {
        return say(usage(ctx.prefix, [`reply to media with ${ctx.prefix}tourl`, 'I will give you a shareable link']));
    }
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'media' } },
            { id: 'u1', use: 'mutate', args: { op: 'upload', source: { step: 'q1' } } },
            { id: 's1', use: 'say', args: { text: '🔗 *UPLOADED*\n\n{{u1.url}}' } },
        ],
        fallbackText: '❌ Upload failed. Try a smaller file or another one.',
    };
}

export async function chatbot(ctx) {
    const arg = String(ctx.args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(arg)) {
        return say(usage(ctx.prefix, [
            `${ctx.prefix}chatbot on   → 🤖 auto-reply to chat`,
            `${ctx.prefix}chatbot off  → 🔇 silence`,
            `current: *${String(ctx.chat?.chatbot || 'off').toUpperCase()}*`,
        ]));
    }
    return rememberChat(
        'chatbot',
        arg,
        arg === 'on' ? '🤖 *CHATBOT ONLINE* — talk to me.' : '🔇 *CHATBOT OFFLINE* — peace restored.'
    );
}

export async function restart() {
    return {
        steps: [
            { id: 's1', use: 'say', args: { text: '♻️ *RESTARTING* — back in a moment.' } },
            { id: 'r1', use: 'schedule', args: { inMs: 600, steps: [{ id: 'x1', use: 'runtime', args: { op: 'restart' } }] } },
        ],
    };
}

export async function update() {
    return {
        steps: [
            { id: 'r1', use: 'react', args: { emoji: '📦' } },
            { id: 'u1', use: 'runtime', args: { op: 'update' } },
            { id: 's1', use: 'say', args: { text: '{{u1.message}}' } },
        ],
        fallbackText: '📦 *UPDATE*\n\nUpdate check failed — the licence server is unreachable.',
    };
}

const VIEW_ONCE_USAGE = (prefix) => usage(prefix, [`reply to a view-once image/video/audio with ${prefix}vv`]);

export async function vv(ctx) {
    if (!ctx.quoted?.viewOnce) return say(VIEW_ONCE_USAGE(ctx.prefix));
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'media', viewOnce: true } },
            { id: 'm1', use: 'media', args: { kind: 'auto', source: { step: 'q1' }, caption: '👁️ *VIEW ONCE REVEALED*' } },
            { id: 'r1', use: 'react', args: { emoji: '✅' } },
        ],
    };
}

export async function v2(ctx) {
    if (!ctx.quoted?.viewOnce) return { steps: [{ id: 'r1', use: 'react', args: { emoji: '❌' } }] };
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'media', viewOnce: true } },
            { id: 'm1', use: 'media', args: { kind: 'auto', source: { step: 'q1' }, to: ctx.sender, caption: '👁️ view-once saved' } },
            { id: 'r1', use: 'react', args: { emoji: '✅' } },
        ],
    };
}

export const OWNER_COMMANDS = {
    mode, setimage, menuimage, botname, getdp, getpp, tomystatus, toallstatus,
    downloadstatus, antidelete, setprefix, tourl, chatbot, restart, update, vv, v2,
};

export { FOOTER };
