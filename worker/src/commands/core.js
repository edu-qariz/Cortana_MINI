import { menuText, usage, FOOTER } from '../text.js';

const say = (text) => ({ steps: [{ id: 's1', use: 'say', args: { text } }] });

export async function menu(ctx) {
    const text = menuText(ctx);
    return {
        steps: [
            { id: 's1', use: 'react', args: { emoji: '🌸' } },
            { id: 's2', use: 'media', args: { kind: 'image', source: { menu: true }, caption: text } },
        ],
        fallbackText: text,
    };
}

export async function ping() {
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
                        + FOOTER,
                },
            },
        ],
    };
}

export async function howToUse(ctx) {
    return say(usage(ctx.prefix, [
        'commands without arguments reply with their own usage',
        `${ctx.prefix}antilink kick on`,
        `${ctx.prefix}v2 (reply to a view-once)`,
    ]));
}
