'use strict';

const fs = require('fs');
const config = require('../config');
const { register } = require('../registry');
const { menuText } = require('../menu');
const { sendBranded } = require('../render');
const { usageBox, humanUptime } = require('../helpers');

register({
    name: 'menu',
    aliases: ['grid', 'help', 'commands'],
    category: 'core',
    description: 'Show the command grid',
    async execute(ctx) {
        const text = menuText();
        await ctx.react('🌸');
        if (fs.existsSync(config.paths.menuImage)) {
            return sendBranded(ctx, { image: fs.readFileSync(config.paths.menuImage), caption: text });
        }
        if (ctx.settings.menuImage && ctx.settings.menuImage !== 'local') {
            return sendBranded(ctx, { image: { url: ctx.settings.menuImage }, caption: text });
        }
        return sendBranded(ctx, { text });
    },
});

register({
    name: 'ping',
    aliases: ['latency', 'alive'],
    category: 'core',
    description: 'Check if the bot is online and responding',
    async execute(ctx) {
        const started = Date.now();
        await ctx.react('🏓');
        const latency = Date.now() - started;
        return sendBranded(ctx, {
            text:
                `🏓 *PONG — CORTANA PRO MINI*\n\n` +
                `🟢 *status:* online & responding\n` +
                `⚡ *latency:* ${latency}ms\n` +
                `⏳ *uptime:* ${humanUptime(process.uptime() * 1000)}\n` +
                `🏷️ *version:* ${config.versionLabel}\n` +
                `🕒 *time:* ${new Date().toLocaleString('en-GB', { hour12: false })}\n\n` +
                '©2026 t.me/techdepro',
        });
    },
});

register({
    name: 'usage',
    category: 'core',
    description: 'Explain how to read command usage',
    hidden: true,
    async execute(ctx) {
        return ctx.reply(usageBox(ctx.prefix, [
            `commands without arguments reply with their own usage`,
            `${ctx.prefix}antilink kick on`,
            `${ctx.prefix}v2 (reply to view-once)`,
        ]));
    },
});
