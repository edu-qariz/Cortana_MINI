import { usage } from '../text.js';

const say = (text) => ({ steps: [{ id: 's1', use: 'say', args: { text } }] });

const rememberChat = (patch, text) => ({
    steps: [
        ...Object.entries(patch).map(([key, value], index) => ({
            id: `r${index + 1}`,
            use: 'remember',
            args: { scope: 'chat', key, value },
        })),
        { id: 's1', use: 'say', args: { text } },
    ],
});

export async function antilink(ctx) {
    const mode = String(ctx.args[0] || '').toLowerCase();
    if (!['kick', 'warn', 'off'].includes(mode)) {
        return say(usage(ctx.prefix, [
            `${ctx.prefix}antilink kick on  → 💀 delete + kick instantly`,
            `${ctx.prefix}antilink warn on  → ⚠️ kick after 3 warnings`,
            `${ctx.prefix}antilink off      → 🚪 keep it off, let the links roam`,
            `current: *${String(ctx.chat?.antilink || 'off').toUpperCase()}*`,
        ]));
    }
    const text = mode === 'off'
        ? '🚪 *ANTILINK DISARMED*\n\nLinks may run wild. Chaos restored. 🙃'
        : mode === 'kick'
            ? '💀 *ANTILINK: KICK MODE*\n\nPost a link. Lose the chat. Simple math.'
            : '⚠️ *ANTILINK: WARN MODE*\n\nThree strikes, then the door. 😈';
    return rememberChat({ antilink: mode }, text);
}

export async function antimention(ctx) {
    const mode = String(ctx.args[0] || '').toLowerCase();
    if (!['kick', 'warn', 'off'].includes(mode)) {
        return say(usage(ctx.prefix, [
            `${ctx.prefix}antimention kick on [limit] → 💀 mass-mention = gone`,
            `${ctx.prefix}antimention warn on [limit] → ⚠️ 3 warnings then gone`,
            `${ctx.prefix}antimention off             → 🕊️ free mentions`,
            `current: *${String(ctx.chat?.antimention || 'off').toUpperCase()}* · limit ${ctx.chat?.antimentionLimit || 5}`,
        ]));
    }
    const limit = Number(ctx.args[2] || ctx.args[1]);
    const patch = { antimention: mode };
    if (Number.isFinite(limit) && limit >= 2 && limit <= 20) patch.antimentionLimit = limit;
    const threshold = patch.antimentionLimit || ctx.chat?.antimentionLimit || 5;
    const text = mode === 'off'
        ? '🕊️ *ANTIMENTION OFF*\n\nTag the whole village. I am not watching. (I am.)'
        : `⚔️ *ANTIMENTION: ${mode.toUpperCase()}*\n\nThreshold: ${threshold} mentions. Pray for the spammer.`;
    return rememberChat(patch, text);
}

export async function antileft(ctx) {
    const arg = String(ctx.args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(arg)) {
        return say(usage(ctx.prefix, [
            `${ctx.prefix}antileft on  → 🔒 the door slams shut on leavers`,
            `${ctx.prefix}antileft off → 🚪 walk out, I dare you`,
            `current: *${String(ctx.chat?.antileft || 'off').toUpperCase()}*`,
        ]));
    }
    return rememberChat(
        { antileft: arg },
        arg === 'on'
            ? '🔒 *PRISON MODE ON*\n\nLeave the group? Bold strategy. You get dragged back. 😈'
            : '🚪 *PRISON MODE OFF*\n\nThe gate is open. Freedom, or whatever this is. 🕊️'
    );
}

export async function antispam(ctx) {
    const arg = String(ctx.args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(arg)) {
        return say(usage(ctx.prefix, [
            `${ctx.prefix}antispam on  → 🚨 flood = deleted + warned`,
            `${ctx.prefix}antispam off → 🌊 let the flood flow`,
            `current: *${String(ctx.chat?.antispam || 'off').toUpperCase()}*`,
        ]));
    }
    return rememberChat(
        { antispam: arg },
        arg === 'on'
            ? '🚨 *ANTISPAM ARMED*\n\nType faster than 8 messages in 8 seconds? Enjoy the void. 🕳️'
            : '🌊 *ANTISPAM OFF*\n\nThe flood gates are open.'
    );
}

export async function setdesc(ctx) {
    const description = String(ctx.text || '').trim();
    if (!description) return say(usage(ctx.prefix, [`${ctx.prefix}setdesc new group description`]));
    return {
        steps: [
            { id: 'm1', use: 'mutate', args: { op: 'description', jid: ctx.chatJid, text: description } },
            { id: 's1', use: 'say', args: { text: '📝 *DESCRIPTION SET*\n\nThe group has lore now.' } },
        ],
        fallbackText: '❌ I could not change the description. Check my admin rights.',
    };
}

export async function setgp(ctx) {
    if (!ctx.quoted?.present && !ctx.args[0]) {
        return say(usage(ctx.prefix, [
            `reply to an image with ${ctx.prefix}setgp`,
            `${ctx.prefix}setgp https://example.com/group.jpg`,
        ]));
    }
    const source = ctx.args[0] ? { url: ctx.args[0] } : { step: 'q1' };
    const steps = [];
    if (!ctx.args[0]) steps.push({ id: 'q1', use: 'query', args: { what: 'media' } });
    steps.push(
        { id: 'm1', use: 'mutate', args: { op: 'picture', jid: ctx.chatJid, source } },
        { id: 's1', use: 'say', args: { text: '🖼️ *GROUP FACE CHANGED*\n\nNew picture, same chaos.' } }
    );
    return { steps, fallbackText: '❌ I could not change the group picture. Check my admin rights.' };
}

export async function hidetag(ctx) {
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'participants', jid: ctx.chatJid } },
            { id: 'm1', use: 'mutate', args: { op: 'tag', jids: '{{q1.jids}}', text: String(ctx.text || '').trim() || '👻' } },
        ],
        fallbackText: '❌ Could not read group members.',
    };
}

export async function tagall(ctx) {
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'participants', jid: ctx.chatJid } },
            { id: 'm1', use: 'mutate', args: { op: 'tag', jids: '{{q1.jids}}', text: `${String(ctx.text || '').trim() || '📣 *ATTENTION EVERYONE*'}\n\n{{q1.taglist}}` } },
        ],
        fallbackText: '❌ Could not read group members.',
    };
}

export async function tagadmins(ctx) {
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'participants', jid: ctx.chatJid } },
            { id: 'm1', use: 'mutate', args: { op: 'tag', jids: '{{q1.admins}}', text: `${String(ctx.text || '').trim() || '🛡️ *ADMIN SUMMON*'}\n\n{{q1.admintaglist}}` } },
        ],
        fallbackText: '🫥 No admins found. Suspicious.',
    };
}

export async function groupid(ctx) {
    return say(`🆔 *GROUP ID*\n\n\`${ctx.chatJid}\`\n\n📱 ${String(ctx.chatJid).split('@')[0]}`);
}

export async function link(ctx) {
    return {
        steps: [
            { id: 'm1', use: 'mutate', args: { op: 'inviteCode', jid: ctx.chatJid } },
            { id: 's1', use: 'say', args: { text: '🔗 *GROUP LINK*\n\nhttps://chat.whatsapp.com/{{m1.code}}\n\n⚠️ Share wisely.' } },
        ],
        fallbackText: '❌ I need admin rights to fetch the link. Promote me. 👑',
    };
}

export async function welcome(ctx) {
    const first = String(ctx.args[0] || '').toLowerCase();
    if (!['on', 'off', 'set'].includes(first)) {
        return say(usage(ctx.prefix, [
            `${ctx.prefix}welcome on  → 👋 greet new members`,
            `${ctx.prefix}welcome off → 🔇 no greeting`,
            `${ctx.prefix}welcome set Welcome {name} to {group}!`,
            `current: *${String(ctx.chat?.welcome || 'off').toUpperCase()}*`,
        ]));
    }
    if (first === 'set') {
        const template = String(ctx.text || '').trim();
        if (!template) return say(usage(ctx.prefix, [`${ctx.prefix}welcome set Welcome {name} to {group}!`]));
        return rememberChat({ welcomeText: template.slice(0, 500) }, `✅ *WELCOME TEMPLATE SET*\n\n${template}`);
    }
    return rememberChat(
        { welcome: first },
        first === 'on' ? '👋 *WELCOME ON* — new humans get greeted.' : '🔇 *WELCOME OFF* — enter silently.'
    );
}

export async function poll(ctx) {
    const raw = String(ctx.text || '');
    const parts = raw.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) {
        return say(usage(ctx.prefix, [
            `${ctx.prefix}poll Question | option 1 | option 2`,
            '2 to 12 options',
        ]));
    }
    const [question, ...options] = parts;
    return {
        steps: [
            { id: 'm1', use: 'mutate', args: { op: 'poll', jid: ctx.chatJid, text: question.slice(0, 120), options: options.slice(0, 12) } },
        ],
    };
}

export async function togroupstatus(ctx) {
    if (!ctx.quoted?.present && !ctx.text) {
        return say(`📌 *GCSTATUS (group status)*\n\nUsage: reply to a text with ${ctx.prefix}togroupstatus, or send ${ctx.prefix}togroupstatus <text>`);
    }
    return {
        steps: [
            { id: 'q1', use: 'query', args: { what: 'statusContent' } },
            { id: 'm1', use: 'mutate', args: { op: 'status', targets: ctx.chatJid, content: '{{q1.content}}', text: ctx.text } },
            { id: 'r1', use: 'react', args: { emoji: '✅' } },
            { id: 's1', use: 'say', args: { text: '✅ *GCSTATUS*\n\nsuccessfully posted your text to this group status😒😭😏' } },
        ],
        fallbackText: '❌ The group status did not post. Try again in a moment.',
    };
}

export const GROUP_COMMANDS = {
    antilink, antimention, antileft, antispam, setdesc, setgp, hidetag,
    tagall, tagadmins, groupid, link, welcome, poll, togroupstatus,
};
