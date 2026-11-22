'use strict';

// Command metadata only. Behaviour lives on the licence server: every entry here
// resolves to a plan of primitives, so nothing about what a command does ships with
// the client. A remoteOnly command that fails to get a plan reports itself offline
// instead of running anything locally.

const { register } = require('../registry');

const COMMANDS = [
    { name: 'menu', description: 'Show the command grid', category: 'core', aliases: ['grid', 'help', 'commands'] },
    { name: 'ping', description: 'Check if the bot is online and responding', category: 'core', aliases: ['latency', 'alive'] },
    { name: 'usage', description: 'Explain how to read command usage', category: 'core', hidden: true },
    { name: 'mode', description: 'Switch bot between public and self mode', category: 'owner', aliases: ['botmode'], ownerOnly: true },
    { name: 'setimage', description: 'Set the menu image from a replied image or URL', category: 'owner', aliases: ['setmenupic'], ownerOnly: true },
    { name: 'menuimage', description: 'Show or replace the current menu image', category: 'owner', aliases: ['menupic'], ownerOnly: true },
    { name: 'botname', description: 'Rename the bot in menu and replies', category: 'owner', ownerOnly: true },
    { name: 'getdp', description: 'Fetch a user profile picture', category: 'owner', aliases: ['dp', 'profilepic'] },
    { name: 'getpp', description: 'Fetch the group profile picture', category: 'owner', aliases: ['gcpp', 'grouppic'], groupOnly: true },
    { name: 'tomystatus', description: 'Post replied media or text to your own status', category: 'owner', ownerOnly: true },
    { name: 'toallstatus', description: 'Post replied media or text as a status in selected groups', category: 'owner', aliases: ['groupstatusall'], ownerOnly: true },
    { name: 'downloadstatus', description: 'Save replied status media to your DM', category: 'owner', aliases: ['savedstatus'] },
    { name: 'antidelete', description: 'Resend deleted messages in this chat', category: 'owner', aliases: ['antidel'], ownerOnly: true },
    { name: 'setprefix', description: 'Change the command prefix', category: 'owner', ownerOnly: true },
    { name: 'tourl', description: 'Upload replied media and get a URL', category: 'owner', aliases: ['upload', 'catbox'] },
    { name: 'chatbot', description: 'Toggle automatic AI replies in this chat', category: 'owner', aliases: ['autochat'], ownerOnly: true },
    { name: 'restart', description: 'Restart the bot process', category: 'owner', aliases: ['reboot'], ownerOnly: true },
    { name: 'update', description: 'Check for a signed release and stage it', category: 'owner', aliases: ['rebuild'], ownerOnly: true },
    { name: 'vv', description: 'Reveal a replied view-once message in place', category: 'owner', aliases: ['viewonce', 'reveal'], ownerOnly: true },
    { name: 'v2', description: 'Send a replied view-once message to your DM silently', category: 'owner', aliases: ['vv2'], ownerOnly: true },
    { name: 'antilink', description: 'Block group invite links', category: 'group', groupOnly: true, adminOnly: true },
    { name: 'antimention', description: 'Block mass mentions', category: 'group', aliases: ['antitag'], groupOnly: true, adminOnly: true },
    { name: 'antileft', description: 'Lock the group door when members leave', category: 'group', aliases: ['antileave'], groupOnly: true, adminOnly: true },
    { name: 'antispam', description: 'Delete rapid-fire spam', category: 'group', groupOnly: true, adminOnly: true },
    { name: 'setdesc', description: 'Set the group description', category: 'group', aliases: ['groupdesc'], groupOnly: true, adminOnly: true },
    { name: 'setgp', description: 'Set the group profile picture', category: 'group', aliases: ['setgpp'], groupOnly: true, adminOnly: true },
    { name: 'hidetag', description: 'Tag everyone without showing the tags', category: 'group', aliases: ['hidetags'], groupOnly: true, adminOnly: true },
    { name: 'tagall', description: 'Tag every group member', category: 'group', aliases: ['everyone'], groupOnly: true, adminOnly: true },
    { name: 'tagadmins', description: 'Tag the group admins', category: 'group', aliases: ['admins'], groupOnly: true, adminOnly: true },
    { name: 'groupid', description: 'Show the group JID', category: 'group', aliases: ['gcid'], groupOnly: true },
    { name: 'link', description: 'Get the group invite link', category: 'group', aliases: ['gclink', 'invite'], groupOnly: true },
    { name: 'welcome', description: 'Configure the welcome message', category: 'group', groupOnly: true, adminOnly: true },
    { name: 'poll', description: 'Create a group poll', category: 'group' },
    { name: 'togroupstatus', description: 'Post replied content as a group status', category: 'group', aliases: ['gcstatus', 'tosgroup'], groupOnly: true },
    { name: 'play', description: 'Download audio from YouTube', category: 'downloader', aliases: ['song', 'ytmp3'] },
    { name: 'video', description: 'Download video from YouTube', category: 'downloader', aliases: ['ytmp4', 'vid'] },
    { name: 'waifu', description: 'Random anime waifu image', category: 'downloader', aliases: ['animepic'] },
    { name: 'lyrics', description: 'Fetch song lyrics', category: 'downloader', aliases: ['lyric'] },
    { name: 'apk', description: 'Search Google Play for apps', category: 'downloader', aliases: ['playstore', 'appsearch'] },
    { name: 'tosticker', description: 'Convert replied media to a sticker', category: 'media', aliases: ['sticker', 's'] },
    { name: 'toimg', description: 'Convert a replied sticker to an image', category: 'media', aliases: ['toimage', 'unsticker'] },
    { name: 'advise', description: 'Random life advice', aliases: ['advice'] },
    { name: 'technews', description: 'Latest technology news with pictures', aliases: ['tech', 'tnews'] },
    { name: 'trending', description: 'Worldwide trending and breaking news with pictures', aliases: ['worldnews', 'breaking'] },
    { name: 'talknow', description: 'Convert text to speech', aliases: ['tts', 'say'] },
    { name: 'robot', description: 'Speak text with a robotic voice', aliases: ['robotvoice'] },
    { name: 'kiss', description: 'Send a kiss reaction image', aliases: ['kisss'] },
    { name: 'gaycheck', description: 'Totally fake rainbow scanner', aliases: ['gaymeter'] },
    { name: 'fast', description: 'Speed up replied audio', aliases: ['speedup'] },
    { name: 'slow', description: 'Slow down replied audio', aliases: ['slowdown'] },
    { name: 'slot', description: 'Play the interactive HTML slot machine', category: 'games', aliases: ['slots'] },
    { name: 'wheel', description: 'Spin the interactive HTML lucky wheel', category: 'games', aliases: ['spin'] },
    { name: 'tictactoe', description: 'Play tic tac toe against the bot', category: 'games', aliases: ['ttt'] },
    { name: 'truth', description: 'Random truth question', category: 'games' },
    { name: 'dare', description: 'Random dare', category: 'games' },
    { name: 'math', description: 'Random math challenge', category: 'games' },
    { name: 'hackall', description: 'Theatrical group hack simulation (prank)', category: 'pranks', aliases: ['grouphack'], groupOnly: true },
    { name: 'hijacknum', description: 'Theatrical number hijack simulation (prank)', category: 'pranks', aliases: ['hijack'] },
    { name: 'cortana', description: 'Ask the Cortana AI', category: 'ai', aliases: ['ai', 'ask'] },
    { name: 'deepseek', description: 'Ask DeepSeek', category: 'ai', aliases: ['ds'] },
    { name: 'chatgpt', description: 'Ask ChatGPT', category: 'ai', aliases: ['gpt', 'openai'] },
];

for (const entry of COMMANDS) {
    register({
        ...entry,
        remoteOnly: true,
        async execute() {
            throw new Error(`command.${entry.name} has no local implementation`);
        },
    });
}

module.exports = { COMMANDS };
