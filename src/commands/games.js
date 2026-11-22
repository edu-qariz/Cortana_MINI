'use strict';

const { TTLMap } = require('../cache');
const logger = require('../logger');
const { register } = require('../registry');
const { sendHtmlMessage } = require('../html-ui');
const { buildSlotHtml, buildWheelHtml } = require('../html-games');
const { usageBox, pick, randInt } = require('../helpers');

const games = new TTLMap({ ttlMs: 15 * 60_000, max: 200, name: 'games' });

const BOARD_FACES = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
];

function render(board) {
    return [0, 3, 6].map((start) =>
        board.slice(start, start + 3).map((cell, index) => {
            if (cell === 'X') return '❌';
            if (cell === 'O') return '⭕';
            return BOARD_FACES[start + index];
        }).join(' ')
    ).join('\n');
}

function winner(board) {
    for (const [a, b, c] of LINES) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    return board.every(Boolean) ? 'draw' : null;
}

function botMove(board) {
    const empty = board.map((cell, index) => (cell ? null : index)).filter((index) => index !== null);
    return empty.length ? pick(empty) : -1;
}

register({
    name: 'slot',
    aliases: ['slots'],
    category: 'games',
    description: 'Play the interactive HTML slot machine',
    async execute(ctx) {
        await ctx.react('🎰');
        try {
            await sendHtmlMessage(ctx.sock, ctx.chat, buildSlotHtml({ botName: ctx.settings.botName }));
            logger.outgoing({ chat: ctx.chat, kind: 'html-game', preview: 'slot machine' });
            return;
        } catch (error) {
            logger.warn(`slot html failed, using text fallback: ${error.message}`);
        }
        const reels = ['🍒', '🍋', '🔔', '💎', '7️⃣', '⭐'];
        const result = [pick(reels), pick(reels), pick(reels)];
        const jackpot = result[0] === result[1] && result[1] === result[2];
        const pair = !jackpot && (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]);
        await ctx.react(jackpot ? '💎' : pair ? '🔔' : '🎰');
        return ctx.reply(
            `🎰 *SLOT MACHINE*\n\n` +
            `┃ ${result.join(' ┃ ')} ┃\n\n` +
            (jackpot ? '💎 *JACKPOT!* The machine fears you.' : pair ? '🔔 *two of a kind* — almost legendary.' : '💸 nothing. the house wins. again.')
        );
    },
});

register({
    name: 'wheel',
    aliases: ['spin'],
    category: 'games',
    description: 'Spin the interactive HTML lucky wheel',
    async execute(ctx) {
        const custom = ctx.text.split('|').map((value) => value.trim()).filter(Boolean);
        const options = custom.length >= 2 ? custom.slice(0, 8) : [];
        await ctx.react('🎡');
        try {
            await sendHtmlMessage(ctx.sock, ctx.chat, buildWheelHtml({ botName: ctx.settings.botName, options }));
            logger.outgoing({ chat: ctx.chat, kind: 'html-game', preview: 'lucky wheel' });
            return;
        } catch (error) {
            logger.warn(`wheel html failed, using text fallback: ${error.message}`);
        }
        const fallback = options.length >= 2
            ? options
            : ['🏆 jackpot', '🍕 free pizza', '😴 nap time', '💀 chaos', '🌈 luck', '🫠 nothing'];
        const chosen = pick(fallback);
        return ctx.reply(
            `🎡 *WHEEL OF DESTINY*\n\n` +
            `🌀 💫 🎡 spinning ${fallback.length} options…\n\n` +
            `🎯 landed on: *${chosen}*\n\n` +
            `_options: ${fallback.join(' · ')}_`
        );
    },
});

register({
    name: 'tictactoe',
    aliases: ['ttt'],
    category: 'games',
    description: 'Play tic tac toe against the bot',
    async execute(ctx) {
        const input = String(ctx.args[0] || '').trim();
        const move = Number(input);

        if (!input) {
            const board = Array(9).fill('');
            games.set(ctx.chat, board);
            return ctx.reply(
                `❌⭕ *TIC TAC TOE*\n\n${render(board)}\n\n` +
                `You are ❌. Move with *${ctx.prefix}tictactoe 5* (1–9).\n` +
                `_The bot is ⭕ and it is already overconfident._`
            );
        }

        const board = games.get(ctx.chat);
        if (!board) {
            return ctx.reply(`🫥 No game running. Start one with *${ctx.prefix}tictactoe*`);
        }
        if (!Number.isInteger(move) || move < 1 || move > 9) {
            return ctx.reply(usageBox(ctx.prefix, [`${ctx.prefix}tictactoe 5`, 'pick a cell from 1 to 9']));
        }
        const index = move - 1;
        if (board[index]) {
            return ctx.reply('🚫 That cell is already occupied. Pick another.');
        }

        board[index] = 'X';
        let state = winner(board);
        if (!state) {
            const botIndex = botMove(board);
            if (botIndex >= 0) board[botIndex] = 'O';
            state = winner(board);
        }

        if (state === 'X') {
            games.delete(ctx.chat);
            await ctx.react('🏆');
            return ctx.reply(`🏆 *YOU WIN*\n\n${render(board)}\n\n_This does not happen often. Frame it._`);
        }
        if (state === 'O') {
            games.delete(ctx.chat);
            await ctx.react('💀');
            return ctx.reply(`💀 *BOT WINS*\n\n${render(board)}\n\n_Skill issue. Run it back._`);
        }
        if (state === 'draw') {
            games.delete(ctx.chat);
            await ctx.react('🤝');
            return ctx.reply(`🤝 *DRAW*\n\n${render(board)}\n\n_Nobody wins. Very diplomatic._`);
        }

        games.set(ctx.chat, board);
        return ctx.reply(`❌⭕ *TIC TAC TOE*\n\n${render(board)}\n\nYour turn: *${ctx.prefix}tictactoe <1-9>*`);
    },
});

register({
    name: 'truth',
    category: 'games',
    description: 'Random truth question',
    async execute(ctx) {
        const truths = [
            'What is the last lie you told? 👀',
            'Who in this group do you secretly mute? 🤫',
            'What is your most useless talent? 🎪',
            'What app do you open first every morning? 📱',
            'What is the pettiest reason you stopped talking to someone? 💅',
        ];
        return ctx.reply(`🫢 *TRUTH*\n\n${pick(truths)}`);
    },
});

register({
    name: 'dare',
    category: 'games',
    description: 'Random dare',
    async execute(ctx) {
        const dares = [
            'Send the last photo in your gallery. No context. 📸',
            'Type your next 3 messages with your eyes closed. 🙈',
            'Voice note a compliment to the last person who texted you. 🎙️',
            'Change your profile picture to something cursed for 10 minutes. 😈',
            'React to this message with the weirdest emoji you have. 🫠',
        ];
        return ctx.reply(`🔥 *DARE*\n\n${pick(dares)}`);
    },
});

register({
    name: 'math',
    category: 'games',
    description: 'Random math challenge',
    async execute(ctx) {
        const a = randInt(2, 19);
        const b = randInt(2, 19);
        const ops = ['+', '-', '×'];
        const op = pick(ops);
        const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
        return ctx.reply(`🧮 *MATH CHALLENGE*\n\n${a} ${op} ${b} = ?\n\n_Answer in chat. No calculator. I am watching._\n\n||answer: ${answer}||`);
    },
});
