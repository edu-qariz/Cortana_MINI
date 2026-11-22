'use strict';

const config = require('./config');
const store = require('./store');

const BOLD_UPPER = 0x1d400;
const BOLD_LOWER = 0x1d41a;
const BOLD_DIGIT = 0x1d7ce;

function bold(text) {
    return [...String(text || '')].map((char) => {
        const code = char.codePointAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(BOLD_UPPER + (code - 65));
        if (code >= 97 && code <= 122) return String.fromCodePoint(BOLD_LOWER + (code - 97));
        if (code >= 48 && code <= 57) return String.fromCodePoint(BOLD_DIGIT + (code - 48));
        return char;
    }).join('');
}

const SECTIONS = [
    {
        title: 'ᴏᴡɴᴇʀ',
        commands: ['mode', 'setimage', 'botname', 'getdp', 'getpp', 'tomystatus', 'vv', 'v2', 'toallstatus', 'downloadstatus', 'antidelete', 'setprefix', 'menuimage', 'tourl', 'chatbot', 'restart', 'update'],
    },
    {
        title: 'ɢʀᴏᴜᴘ',
        commands: ['antilink', 'antimention', 'togroupstatus', 'antispam', 'setdesc', 'setgp', 'hidetag', 'tagall', 'tagadmins', 'groupid', 'link', 'welcome', 'poll'],
    },
    {
        title: 'ᴅᴏᴡɴʟᴏᴀᴅᴇʀ',
        commands: ['play', 'video', 'waifu', 'lyrics', 'apk'],
    },
    {
        title: 'ᴀɪ',
        commands: ['cortana', 'deepseek', 'chatgpt'],
    },
    {
        title: 'ᴀʟʟ',
        commands: ['ping', 'advise', 'technews', 'trending', 'hackall', 'hijacknum', 'tosticker', 'toimg', 'talknow', 'kiss', 'gaycheck', 'fast', 'slow', 'robot'],
    },
    {
        title: 'ɢᴀᴍᴇs',
        commands: ['wheel', 'slot', 'tictactoe'],
    },
];

function menuText() {
    const settings = store.getSettings();
    const name = settings.botName || config.botName;
    const lines = [
        `ᯓ ${bold(name)} ${bold(config.versionLabel)}`,
        '⯐ ⟁ ꕤ ᴄᴏᴍᴍᴀɴᴅ ɢʀɪᴅ ꕤ ⟁ ⯐',
        '',
    ];
    SECTIONS.forEach((section, index) => {
        if (index > 0) lines.push('', '⨳', '');
        lines.push(`ꕤ ${section.title}`);
        for (const command of section.commands) lines.push(`ᝰ ${bold(command)}`);
    });
    lines.push('', '©2026 t.me/techdepro');
    return lines.join('\n');
}

function categorySummary() {
    return SECTIONS.map((section) => ({ title: section.title, commands: section.commands.length }));
}

module.exports = { menuText, categorySummary, SECTIONS, bold };
