'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const COLOR = process.stdout.isTTY !== false && !process.env.NO_COLOR;
const paint = (code, text) => (COLOR ? `\x1b[${code}m${text}\x1b[0m` : String(text));

const C = {
    reset: (s) => paint('0', s),
    dim: (s) => paint('2', s),
    bold: (s) => paint('1', s),
    red: (s) => paint('31', s),
    green: (s) => paint('32', s),
    yellow: (s) => paint('33', s),
    blue: (s) => paint('34', s),
    magenta: (s) => paint('35', s),
    cyan: (s) => paint('36', s),
    white: (s) => paint('37', s),
    gray: (s) => paint('90', s),
    brightCyan: (s) => paint('96', s),
    brightMagenta: (s) => paint('95', s),
    brightGreen: (s) => paint('92', s),
    brightRed: (s) => paint('91', s),
};

const c256 = (code, text) => (COLOR ? `\x1b[38;5;${code}m${text}\x1b[0m` : String(text));
const GRADIENT = [51, 45, 39, 135, 171, 207, 213];
const NOISE = ['▚', '▞', '░', '▒', '▖', '▘'];

const sleep = (ms) => {
    try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    } catch { /* no SharedArrayBuffer — skip the pause */ }
};

// Two-row block wordmark: CORTANA over a centred MINI.
const ART = [
    '█▀▀ █▀█ █▀▄ ▀█▀ █▀█ █▄░█ █▀█',
    '█▄▄ █▄█ █▀▄ ░█░ █▀█ █░▀█ █▀█',
    '       █▀▄▀█ █ █▄░█ █',
    '       █░▀░█ █ █░▀█ █',
];
const MINI_ROWS = [2, 3];

function paintArt(line, row) {
    if (!COLOR) return line;
    const palette = MINI_ROWS.includes(row) ? [213, 207, 171, 135] : GRADIENT;
    return [...line]
        .map((ch, index) => (ch === ' ' ? ch : c256(palette[Math.floor(index / 4) % palette.length], ch)))
        .join('');
}

function glitchArt(line, frame) {
    if (!COLOR) return line;
    return [...line]
        .map((ch, index) => {
            if (ch === ' ') return ch;
            if ((index * 7 + frame * 11) % 13 === 0) {
                return c256(196, NOISE[(index + frame) % NOISE.length]);
            }
            return c256(GRADIENT[(index + frame) % GRADIENT.length], ch);
        })
        .join('');
}

function block(frame = -1) {
    return ART.map((line, row) => `  ${frame < 0 ? paintArt(line, row) : glitchArt(line, frame)}`).join('\n');
}

function art() {
    return ART.map((line, row) => paintArt(line, row));
}

const MAX_EVENTS = 250;
const events = [];
let eventSeq = 0;
const subscribers = new Set();

function emit(level, scope, message, extra) {
    const event = {
        id: ++eventSeq,
        at: new Date().toISOString(),
        level,
        scope,
        message: String(message || ''),
        extra: extra || null,
    };
    events.push(event);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    for (const fn of subscribers) {
        try { fn(event); } catch { /* subscriber failures must never break the bot */ }
    }
    return event;
}

function stamp() {
    return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

const QUIET = String(config.logLevel).toLowerCase() === 'silent';

// While the pairing prompt is waiting for input, console writes are buffered so
// they cannot overwrite the line the user is typing (or pasting) their number.
let consolePaused = false;
const pausedLines = [];

function print(fn) {
    if (consolePaused) {
        if (pausedLines.length < 300) pausedLines.push(fn);
        return;
    }
    try { fn(); } catch { /* console failures must never break the bot */ }
}

function pauseConsole() {
    consolePaused = true;
}

function resumeConsole() {
    consolePaused = false;
    const lines = pausedLines.splice(0);
    for (const fn of lines) {
        try { fn(); } catch { /* keep flushing */ }
    }
}

function info(message, extra) {
    emit('info', 'core', message, extra);
    if (!QUIET) print(() => console.log(`${C.gray(stamp())} ${C.cyan('◆')} ${message}`));
}

function success(message, extra) {
    emit('info', 'core', message, extra);
    if (!QUIET) print(() => console.log(`${C.gray(stamp())} ${C.brightGreen('✔')} ${C.green(message)}`));
}

function warn(message, extra) {
    emit('warn', 'core', message, extra);
    if (!QUIET) print(() => console.warn(`${C.gray(stamp())} ${C.yellow('▲')} ${C.yellow(message)}`));
}

function debug(message, extra) {
    emit('debug', 'core', message, extra);
    if (!QUIET && String(config.logLevel).toLowerCase() === 'debug') {
        print(() => console.log(`${C.gray(stamp())} ${C.gray('·')} ${C.gray(message)}`));
    }
}

function serializeError(error) {
    if (!error) return 'unknown error';
    if (typeof error === 'string') return error;
    const parts = [error.stack || error.message || String(error)];
    if (error.cause) parts.push(`cause: ${error.cause.message || error.cause}`);
    return parts.join('\n');
}

function rotateIfNeeded(file) {
    try {
        if (!fs.existsSync(file)) return;
        if (fs.statSync(file).size < 2 * 1024 * 1024) return;
        const backup = `${file}.1`;
        if (fs.existsSync(backup)) fs.rmSync(backup, { force: true });
        fs.renameSync(file, backup);
    } catch { /* rotation is best effort */ }
}

function error(scope, err, extra) {
    const text = serializeError(err);
    emit('error', scope, text.split('\n')[0], { ...extra, detail: text });
    const file = path.join(config.paths.logs, 'errors.log');
    try {
        rotateIfNeeded(file);
        const line = `[${new Date().toISOString()}] [${scope}] ${text}\n`;
        fs.appendFileSync(file, line, 'utf8');
    } catch { /* never throw from the logger */ }
    print(() => console.error(`\n${C.red('╭─ ✖ ERROR')} ${C.gray(scope)}\n${text.split('\n').map((l) => C.red('│ ') + l).join('\n')}\n${C.red('╰─')}\n`));
}

function banner() {
    if (COLOR && process.stdout.isTTY) {
        for (let frame = 0; frame < 3; frame += 1) {
            if (frame > 0) process.stdout.write(`\x1b[${ART.length}A`);
            process.stdout.write(`${block(frame)}\n`);
            sleep(55);
        }
        process.stdout.write(`\x1b[${ART.length}A`);
    }
    console.log(block(-1));
    console.log(`  ${C.gray('─'.repeat(46))}`);
    console.log(`  ${C.dim('Powered by')} ${c256(45, 'CORTANA')} ${C.gray('·')} ${c256(207, 'Eduqariz')}`);
    console.log('');
}

function divider(label) {
    const text = ` ${label} `;
    const width = Math.max(8, 48 - text.length);
    console.log(C.gray('─'.repeat(2)) + C.brightMagenta(text) + C.gray('─'.repeat(width)));
}

function incoming({ chat, sender, type, text, group }) {
    emit('in', 'message', text || `[${type}]`, { chat, sender, type, group: !!group });
    const body = String(text || '').replace(/\s+/g, ' ').slice(0, 140) || `[${type}]`;
    print(() => console.log(
        `\n${C.brightCyan('╭─ 📥 INCOMING')} ${C.gray(stamp())}\n` +
        `${C.brightCyan('│')} ${C.gray('chat  ')} ${chat}\n` +
        `${C.brightCyan('│')} ${C.gray('from  ')} ${sender}${group ? C.gray(' · group') : ''}\n` +
        `${C.brightCyan('│')} ${C.gray('type  ')} ${type}\n` +
        `${C.brightCyan('╰─')} ${C.white(body)}`
    ));
}

function outgoing({ chat, kind, preview, ms }) {
    emit('out', 'message', preview || kind, { chat, kind, ms });
    const body = String(preview || '').replace(/\s+/g, ' ').slice(0, 120);
    print(() => console.log(
        `${C.brightGreen('╭─ 📤 OUTGOING')} ${C.gray(stamp())} ${ms ? C.gray(`${ms}ms`) : ''}\n` +
        `${C.brightGreen('│')} ${C.gray('chat  ')} ${chat}\n` +
        `${C.brightGreen('│')} ${C.gray('kind  ')} ${kind}\n` +
        `${C.brightGreen('╰─')} ${C.white(body)}`
    ));
}

function command({ name, sender, chat, group }) {
    emit('cmd', 'command', name, { sender, chat, group: !!group });
    print(() => console.log(`\n${C.brightMagenta('⚡ COMMAND')} ${C.bold(name)} ${C.gray('·')} ${sender} ${C.gray(group ? '· group' : '· dm')}`));
}

function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
}

function recentEvents(limit = 100) {
    return events.slice(-limit);
}

module.exports = {
    C,
    art,
    c256,
    banner,
    divider,
    pauseConsole,
    resumeConsole,
    info,
    success,
    warn,
    debug,
    error,
    incoming,
    outgoing,
    command,
    subscribe,
    recentEvents,
    serializeError,
};
