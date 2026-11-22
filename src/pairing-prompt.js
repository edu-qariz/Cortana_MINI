'use strict';

const readline = require('readline');
const logger = require('./logger');

const { C, art } = logger;
const CYAN = C.brightCyan;
const RED = C.brightRed;

function width() {
    const columns = Number(process.stdout.columns) || 50;
    return Math.min(46, Math.max(30, columns - 4));
}

function rule(char) {
    return C.gray(char.repeat(width()));
}

function centerPlain(text, size) {
    const value = String(text);
    if (value.length >= size) return value;
    return `${' '.repeat(Math.floor((size - value.length) / 2))}${value}`;
}

function printAsk(hint = '') {
    console.log('');
    for (const line of art()) console.log(`  ${line}`);
    console.log(`  ${rule('─')}`);
    console.log(`  ${C.bold('Enter your number to pair')}`);
    console.log('');
    console.log(`  ${C.gray('NB//')} no ${C.gray('+')} · start with country code · 254712345678`);
    console.log('');
    if (hint) {
        console.log(`  ${RED('✖')} ${hint}`);
        console.log('');
    }
}

function printPairingCode(code, phone, expiresInMs = 60_000) {
    const raw = String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const digits = String(phone || '').replace(/[^0-9]/g, '');
    const seconds = Math.max(1, Math.round(expiresInMs / 1000));
    const shown = [...raw].join(' ');
    console.log('');
    console.log(`  ${rule('▔')}`);
    console.log('');
    console.log(`  ${C.bold(centerPlain('YOUR PAIRING CODE IS', width()))}`);
    console.log('');
    console.log(`  ${C.bold(RED(centerPlain(shown, width())))}`);
    console.log('');
    console.log(`  ${rule('▁')}`);
    console.log('');
    console.log(`  WhatsApp ${C.gray('→')} Linked devices ${C.gray('→')} Link with phone number`);
    console.log(`  ${C.gray('enter the code there')} ${C.gray('·')} expires in ${C.bold(`${seconds}s`)}`);
    if (digits) console.log(`  ${C.gray('number')} ${C.gray(`+${digits}`)}`);
    console.log('');
}

function promptForNumber() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        let attempt = 0;
        let settled = false;

        // Buffer logger output so connection notices cannot overwrite the
        // number the user is typing/pasting.
        logger.pauseConsole();
        const settle = (value) => {
            if (settled) return;
            settled = true;
            logger.resumeConsole();
            resolve(value);
        };

        const ask = () => {
            attempt += 1;
            printAsk(attempt > 1 ? 'that number looks wrong — try again' : '');
            rl.question(`  ${CYAN('▸')} `, (answer) => {
                const digits = String(answer || '').replace(/[^0-9]/g, '');
                if (digits.length >= 8 && digits.length <= 15) {
                    rl.close();
                    settle(digits);
                    return;
                }
                if (attempt >= 3) {
                    rl.close();
                    console.log(`  ${RED('✖')} cancelled ${C.gray('— open the panel and generate the code there')}\n`);
                    settle('');
                    return;
                }
                console.log(`  ${RED('✖')} enter 8–15 digits ${C.gray('·')} international format ${C.gray('·')} no +\n`);
                ask();
            });
        };

        rl.on('SIGINT', () => {
            rl.close();
            console.log('');
            settle('');
        });

        ask();
    });
}

module.exports = { promptForNumber, printPairingCode, printAsk };
