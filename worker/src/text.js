const BOLD_UPPER = 0x1d400;
const BOLD_LOWER = 0x1d41a;
const BOLD_DIGIT = 0x1d7ce;

export function bold(text) {
    return [...String(text || '')].map((char) => {
        const code = char.codePointAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(BOLD_UPPER + (code - 65));
        if (code >= 97 && code <= 122) return String.fromCodePoint(BOLD_LOWER + (code - 97));
        if (code >= 48 && code <= 57) return String.fromCodePoint(BOLD_DIGIT + (code - 48));
        return char;
    }).join('');
}

export function usage(prefix, lines) {
    return [`╭─ ⚠️ 𝗨𝗦𝗔𝗚𝗘`, ...lines.map((line) => `│ ${line}`), '╰─'].join('\n');
}

export const FOOTER = '©2026 t.me/techdepro';

export const SECTIONS = [
    {
        title: 'ᴏᴡɴᴇʀ',
        commands: ['mode', 'setimage', 'botname', 'getdp', 'getpp', 'tomystatus', 'vv', 'v2', 'toallstatus', 'downloadstatus', 'antidelete', 'setprefix', 'menuimage', 'tourl', 'chatbot', 'restart', 'update'],
    },
    {
        title: 'ɢʀᴏᴜᴘ',
        commands: ['antilink', 'antimention', 'togroupstatus', 'antispam', 'setdesc', 'setgp', 'hidetag', 'tagall', 'tagadmins', 'groupid', 'link', 'welcome', 'poll'],
    },
    { title: 'ᴅᴏᴡɴʟᴏᴀᴅᴇʀ', commands: ['play', 'video', 'waifu', 'lyrics', 'apk'] },
    { title: 'ᴀɪ', commands: ['cortana', 'deepseek', 'chatgpt'] },
    {
        title: 'ᴀʟʟ',
        commands: ['ping', 'advise', 'technews', 'trending', 'hackall', 'hijacknum', 'tosticker', 'toimg', 'talknow', 'kiss', 'gaycheck', 'fast', 'slow', 'robot'],
    },
    { title: 'ɢᴀᴍᴇs', commands: ['wheel', 'slot', 'tictactoe'] },
];

export function menuText({ botName, versionLabel }) {
    const lines = [
        `ᯓ ${bold(botName || 'CORTANA PRO MINI')} ${bold(versionLabel || '')}`.trim(),
        '⯐ ⟁ ꕤ ᴄᴏᴍᴍᴀɴᴅ ɢʀɪᴅ ꕤ ⟁ ⯐',
        '',
    ];
    SECTIONS.forEach((section, index) => {
        if (index > 0) lines.push('', '⨳', '');
        lines.push(`ꕤ ${section.title}`);
        for (const command of section.commands) lines.push(`ᝰ ${bold(command)}`);
    });
    lines.push('', FOOTER);
    return lines.join('\n');
}
