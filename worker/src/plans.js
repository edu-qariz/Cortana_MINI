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

const AI_SYSTEM =
    'You are CORTANA MINI, a compact WhatsApp assistant. Answer in the language the user wrote in. '
    + 'Keep replies under 900 characters unless asked for detail. Use WhatsApp formatting: *bold*, _italic_, ```code```. '
    + 'Never claim to access the user device, files or WhatsApp account.';

const PROVIDERS = {
    groq: {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        key: 'GROQ_API_KEY',
        model: 'GROQ_MODEL',
        fallbackModel: 'llama-3.3-70b-versatile',
    },
    deepseek: {
        url: 'https://api.deepseek.com/chat/completions',
        key: 'DEEPSEEK_API_KEY',
        model: 'DEEPSEEK_MODEL',
        fallbackModel: 'deepseek-chat',
    },
    openai: {
        url: 'https://api.openai.com/v1/chat/completions',
        key: 'OPENAI_API_KEY',
        model: 'OPENAI_MODEL',
        fallbackModel: 'gpt-4o-mini',
    },
};

const AI_CHAINS = {
    cortana: ['groq', 'deepseek', 'openai'],
    deepseek: ['deepseek', 'groq', 'openai'],
    chatgpt: ['openai', 'groq', 'deepseek'],
};

const ALIASES = {
    ai: 'cortana', ask: 'cortana', ds: 'deepseek', gpt: 'chatgpt', openai: 'chatgpt',
    advice: 'advise', slots: 'slot', spin: 'wheel', latency: 'ping', alive: 'ping',
    help: 'usage',
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function say(text) {
    return { steps: [{ id: 's1', use: 'say', args: { text } }] };
}

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
    const model = env[spec.model] || spec.fallbackModel;
    const response = await fetch(spec.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model,
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

/**
 * Turns a command into a plan made of client primitives.
 * Returns null for commands the client still executes locally.
 */
export async function buildPlan({ command, args = {}, context = {}, env }) {
    const name = ALIASES[command] || command;

    if (name === 'ping') {
        return {
            steps: [
                { id: 's1', use: 'runtime', args: { op: 'metrics' } },
                {
                    id: 's2',
                    use: 'say',
                    args: {
                        text:
                            '🏓 *PONG — CORTANA PRO MINI*\n\n'
                            + '🟢 *status:* online & responding\n'
                            + '⚡ *latency:* {{s1.latencyMs}}ms\n'
                            + '⏳ *uptime:* {{s1.uptime}}\n'
                            + '🏷️ *version:* {{s1.version}}\n'
                            + '🕒 *time:* {{s1.time}}\n\n'
                            + '©2026 t.me/techdepro',
                    },
                },
            ],
        };
    }

    if (name === 'usage') {
        return say(
            '🧭 *HOW TO READ USAGE*\n\n'
            + 'Commands without arguments reply with their own usage.\n'
            + '`.antilink kick on`\n'
            + '`.v2` (reply to a view-once message)\n\n'
            + '©2026 t.me/techdepro'
        );
    }

    if (name === 'advise') {
        return say(`💡 *ADVICE*\n\n${pick(ADVICE)}\n\n©2026 t.me/techdepro`);
    }

    if (name === 'truth') {
        return say(`🫢 *TRUTH*\n\n${pick(TRUTHS)}\n\n©2026 t.me/techdepro`);
    }

    if (name === 'dare') {
        return say(`😈 *DARE*\n\n${pick(DARES)}\n\n©2026 t.me/techdepro`);
    }

    if (name === 'slot') {
        const reels = [pick(SLOT_FACES), pick(SLOT_FACES), pick(SLOT_FACES)];
        const jackpot = reels[0] === reels[1] && reels[1] === reels[2];
        const pair = reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2];
        const verdict = jackpot ? '💎 *JACKPOT* — three of a kind!' : pair ? '✨ close — two matched.' : '😅 no match, spin again.';
        return say(`🎰 *SLOT*\n\n┃ ${reels.join(' ┃ ')} ┃\n\n${verdict}\n\n©2026 t.me/techdepro`);
    }

    if (name === 'wheel') {
        const options = Array.isArray(args.options)
            ? args.options.map((value) => String(value).slice(0, 40)).filter(Boolean).slice(0, 20)
            : [];
        const winner = options.length ? pick(options) : String(1 + Math.floor(Math.random() * 100));
        return say(`🎡 *WHEEL*\n\n${WHEEL_FACES.join(' ')}\n\n🎯 *landed on:* ${winner}\n\n©2026 t.me/techdepro`);
    }

    if (AI_CHAINS[name]) {
        const prompt = String(args.text || args.prompt || '').trim();
        if (!prompt) {
            return say(`🤖 *${name.toUpperCase()}*\n\nSend a question, e.g. \`.${name} explain recursion simply\`.\n\n©2026 t.me/techdepro`);
        }
        const answer = await askAI(env, name, prompt, context.history);
        if (!answer) {
            return say('⚠️ *AI is not available right now.*\n\nNo provider key answered — try again in a moment.');
        }
        return say(answer);
    }

    return null;
}
