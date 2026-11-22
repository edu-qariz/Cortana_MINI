'use strict';

const logger = require('../logger');
const mediaTools = require('../media');
const { register } = require('../registry');
const { downloadFrom, usageBox, humanBytes } = require('../helpers');

register({
    name: 'tosticker',
    aliases: ['sticker', 's'],
    category: 'media',
    description: 'Convert replied media to a sticker',
    async execute(ctx) {
        try {
            const media = await downloadFrom(ctx.sock, ctx.msg, ctx.chat, true);
            if (!media) {
                return ctx.reply(usageBox(ctx.prefix, [
                    `reply to an image, video or gif with ${ctx.prefix}tosticker`,
                ]));
            }
            if (media.kind === 'sticker') return ctx.reply('🙃 That is already a sticker, genius.');
            await ctx.react('🎨');
            const webp = await mediaTools.toSticker(media.buffer);
            await ctx.send({ sticker: webp });
            await ctx.react('✅');
        } catch (error) {
            logger.error('command.tosticker', error);
            await ctx.react('❌');
            return ctx.reply('❌ That sticker did not survive the conversion. Try another one.');
        }
    },
});

register({
    name: 'toimg',
    aliases: ['toimage', 'unsticker'],
    category: 'media',
    description: 'Convert a replied sticker to an image',
    async execute(ctx) {
        try {
            const media = await downloadFrom(ctx.sock, ctx.msg, ctx.chat, true);
            if (!media || media.kind !== 'sticker') {
                return ctx.reply(usageBox(ctx.prefix, [`reply to a sticker with ${ctx.prefix}toimg`]));
            }
            await ctx.react('🖼️');
            const png = await mediaTools.toImage(media.buffer);
            await ctx.send({ image: png, caption: `🖼️ converted · ${humanBytes(png.length)}` });
            await ctx.react('✅');
        } catch (error) {
            logger.error('command.toimg', error);
            await ctx.react('❌');
            return ctx.reply('❌ I could not turn that sticker into an image.');
        }
    },
});
