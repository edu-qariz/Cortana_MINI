import { menu, ping, howToUse } from './commands/core.js';
import { OWNER_COMMANDS } from './commands/owner.js';
import { GROUP_COMMANDS } from './commands/group.js';
import { FOOTER } from './text.js';

const ADVICE = [
    'Do the smallest next thing. Momentum beats motivation.',
    'Write it down before you argue with it.',
    'If it takes under two minutes, do it now.',
    'Sleep on the decision, not on the work.',
    'Ask once, listen twice.',
    'Money follows attention. Spend both on purpose.',
    'You cannot fix a system you are unwilling to measure.',
    'Say no early, so your yes means something.',
    'Backups are cheaper than apologies.',
    'Slow is smooth, smooth is fast.',
];

const TRUTHS = [
    'What is the last thing you searched on your phone?',
    'Who did you last lie to, and why?',
    'Name one thing you pretend not to care about.',
    'What would you do with a free month and no obligations?',
    'Whose opinion can ruin your day?',
    'What is the most expensive mistake you have made?',
    'Which habit would you delete if you could?',
    'What compliment do you never believe?',
];

const DARES = [
    'Send the last emoji you used as your status for an hour.',
    'Type your next message with your eyes closed.',
    'Voice-note the alphabet backwards in under 30 seconds.',
    'Change your profile picture to your most awkward photo for 10 minutes.',
    'Reply to the next message using only emojis.',
    'Call someone and say "I was thinking about you", then hang up.',
    'Send a screenshot of your home screen.',
    'Speak only in questions for the next five messages.',
];

const SLOT_FACES = ['🍒', '🍋', '🔔', '💎', '7️⃣', '⭐'];
const WHEEL_FACES = ['🎯', '🎲', '🎁', '🍀', '🔮', '⚡'];

const ALIASES = {
    ai: 'cortana', ask: 'cortana', ds: 'deepseek', gpt: 'chatgpt', openai: 'chatgpt',
    advice: 'advise', slots: 'slot', spin: 'wheel', latency: 'ping', alive: 'ping',
    help: 'usage', grid: 'menu', commands: 'menu',
    botmode: 'mode', setmenupic: 'setimage', menupic: 'menuimage', dp: 'getdp', profilepic: 'getdp',
    gcpp: 'getpp', grouppic: 'getpp', groupstatusall: 'toallstatus', savedstatus: 'downloadstatus',
    antidel: 'antidelete', upload: 'tourl', catbox: 'tourl', autochat: 'chatbot', reboot: 'restart',
    rebuild: 'update', viewonce: 'vv', reveal: 'vv', vv2: 'v2',
    antitag: 'antimention', antileave: 'antileft', groupdesc: 'setdesc', setgpp: 'setgp',
    hidetags: 'hidetag', everyone: 'tagall', admins: 'tagadmins', gcid: 'groupid',
    gclink: 'link', invite: 'link', gcstatus: 'togroupstatus', tosgroup: 'togroupstatus',
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const say = (text) => ({ steps: [{ id: 's1', use: 'say', args: { text } }] });

const AI_SYSTEM =
    'You are CORTANA MINI, a compact WhatsApp assistant. Answer in the language the user wrote in. '
    + 'Keep replies under 900 characters unless asked for detail. Use WhatsApp formatting: *bold*, _italic_, ```code```. '
    + 'Never claim to access the user device, files or WhatsApp account.';

const AI_CHAINS = {
    cortana: ['groq', 'deepseek', 'openai'],
    deepseek: ['deepseek', 'groq', 'openai'],
    chatgpt: ['openai', 'groq', 'deepseek'],
};

const PROVIDERS = {
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY', model: 'GROQ_MODEL', fallbackModel: 'llama-3.3-70b-versatile' },
    deepseek: { url: 'https://api.deepseek.com/chat/completions', key: 'DEEPSEEK_API_KEY', model: 'DEEPSEEK_MODEL', fallbackModel: 'deepseek-chat' },
    openai: { url: 'https://api.openai.com/v1/chat/completions', key: 'OPENAI_API_KEY', model: 'OPENAI_MODEL', fallbackModel: 'gpt-4o-mini' },
};

function safeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
        .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string')
        .slice(-8)
        .map((entry) => ({ role: entry.role, content: entry.content.slice(0, 1200) }));
}

async function askProvider(env, provider, prompt, history) {
    const spec = PROVIDERS[provider];
    const key = env[spec.key];
    if (!key) return null;
    const response = await fetch(spec.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model: env[spec.model] || spec.fallbackModel,
            temperature: 0.6,
            max_tokens: 700,
            messages: [
                { role: 'system', content: AI_SYSTEM },
                ...safeHistory(history),
                { role: 'user', content: prompt },
            ],
        }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
}

async function askAI(env, command, prompt, history) {
    for (const provider of AI_CHAINS[command] || AI_CHAINS.cortana) {
        try {
            const answer = await askProvider(env, provider, prompt, history);
            if (answer) return answer;
        } catch { /* try the next provider */ }
    }
    return null;
}

export function contextFrom(body, command) {
    const raw = body.context && typeof body.context === 'object' ? body.context : {};
    const args = Array.isArray(body.args) ? body.args.map((value) => String(value)) : [];
    return {
        command,
        prefix: String(raw.prefix || '.').slice(0, 2),
        settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
        chat: raw.chat && typeof raw.chat === 'object' ? raw.chat : {},
        quoted: raw.quoted && typeof raw.quoted === 'object' ? raw.quoted : { present: false },
        mentions: Array.isArray(raw.mentions) ? raw.mentions.slice(0, 50) : [],
        isGroup: Boolean(raw.group),
        isOwner: Boolean(raw.owner),
        isAdmin: Boolean(raw.admin),
        chatJid: String(raw.chatJid || ''),
        sender: String(raw.sender || ''),
        versionLabel: String(raw.version || ''),
        botName: String(raw.settings?.botName || 'CORTANA PRO MINI'),
        args,
        text: args.join(' '),
    };
}

function simpleGame(name, ctx) {
    if (name === 'advise') return say(`💡 *ADVICE*\n\n${pick(ADVICE)}\n\n${FOOTER}`);
    if (name === 'truth') return say(`🫢 *TRUTH*\n\n${pick(TRUTHS)}\n\n${FOOTER}`);
    if (name === 'dare') return say(`😈 *DARE*\n\n${pick(DARES)}\n\n${FOOTER}`);
    if (name === 'slot') {
        const reels = [pick(SLOT_FACES), pick(SLOT_FACES), pick(SLOT_FACES)];
        const jackpot = reels[0] === reels[1] && reels[1] === reels[2];
        const pair = reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2];
        const verdict = jackpot ? '💎 *JACKPOT* — three of a kind!' : pair ? '✨ close — two matched.' : '😅 no match, spin again.';
        return say(`🎰 *SLOT*\n\n┃ ${reels.join(' ┃ ')} ┃\n\n${verdict}\n\n${FOOTER}`);
    }
    if (name === 'wheel') {
        const options = ctx.args.map((value) => value.slice(0, 40)).filter(Boolean).slice(0, 20);
        const winner = options.length ? pick(options) : String(1 + Math.floor(Math.random() * 100));
        return say(`🎡 *WHEEL*\n\n${WHEEL_FACES.join(' ')}\n\n🎯 *landed on:* ${winner}\n\n${FOOTER}`);
    }
    return null;
}

function prank(name) {
    const lines = name === 'hackall'
        ? ['💀 *CONNECTION ESTABLISHED*', '🔎 scanning group members…', '🧨 injecting payload…', '😈 *GROUP COMPROMISED* (this is theatre, nothing happened)']
        : ['📡 *TRACING NUMBER*', '🛰️ hopping relays…', '🔐 bypassing shields…', '😈 *HIJACK COMPLETE* (this is theatre, nothing happened)'];
    return {
        steps: [
            { id: 's1', use: 'say', args: { text: lines[0] } },
            {
                id: 'sc1',
                use: 'schedule',
                args: {
                    inMs: 900,
                    steps: lines.slice(1).map((text, index) => ({
                        id: `t${index}`,
                        use: index === lines.length - 2 ? 'say' : 'say',
                        args: { text },
                    })),
                },
            },
        ],
    };
}

/**
 * Turns a command into a plan made of client primitives.
 * Returns null for commands the client still executes locally.
 */
export async function buildPlan({ command, args = [], context = {}, env }) {
    const name = ALIASES[command] || command;
    const ctx = contextFrom({ args, context }, name);

    if (name === 'menu') return menu(ctx);
    if (name === 'ping') return ping();
    if (name === 'usage') return howToUse(ctx);

    if (OWNER_COMMANDS[name]) return OWNER_COMMANDS[name](ctx);
    if (GROUP_COMMANDS[name]) return GROUP_COMMANDS[name](ctx);

    if (name === 'hackall' || name === 'hijacknum') return prank(name);

    const game = simpleGame(name, ctx);
    if (game) return game;

    if (AI_CHAINS[name]) {
        const prompt = String(ctx.text || '').trim();
        if (!prompt) {
            return say(`🤖 *${name.toUpperCase()}*\n\nSend a question, e.g. \`.${name} explain recursion simply\`.\n\n${FOOTER}`);
        }
        const answer = await askAI(env, name, prompt, context.history);
        if (!answer) return say('⚠️ *AI is not available right now.*\n\nNo provider key answered — try again in a moment.');
        return say(answer);
    }

    return null;
}
