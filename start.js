#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const logger = require('./src/logger');
const store = require('./src/store');
const bot = require('./src/bot');
const panel = require('./src/panel');
const pairingPrompt = require('./src/pairing-prompt');

let exiting = false;
const lockFile = process.env.LOCK_FILE
    ? path.resolve(config.paths.home, process.env.LOCK_FILE)
    : path.join(config.paths.data, 'instance.lock');

function acquireLock() {
    try {
        if (fs.existsSync(lockFile)) {
            const pid = Number(String(fs.readFileSync(lockFile, 'utf8')).trim());
            if (pid && pid !== process.pid) {
                try {
                    process.kill(pid, 0);
                    return { ok: false, pid };
                } catch { /* stale lock from a dead process */ }
            }
        }
        fs.writeFileSync(lockFile, String(process.pid), 'utf8');
        return { ok: true };
    } catch {
        return { ok: true };
    }
}

function releaseLock() {
    try {
        if (fs.existsSync(lockFile) && String(fs.readFileSync(lockFile, 'utf8')).trim() === String(process.pid)) {
            fs.rmSync(lockFile, { force: true });
        }
    } catch { /* best effort */ }
}

async function shutdown(signal) {
    if (exiting) return;
    exiting = true;
    logger.warn(`${signal} received — shutting down`);
    try {
        await panel.stop();
        await bot.shutdown();
    } catch (error) {
        logger.error('shutdown', error);
    }
    releaseLock();
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (error) => {
    logger.error('unhandledRejection', error);
});

process.on('uncaughtException', (error) => {
    logger.error('uncaughtException', error);
});

(async () => {
    store.load();
    logger.banner();
    logger.info(`version ${config.versionLabel} · node ${process.version} · ${config.timezone}`);
    logger.info(`state dir ${config.paths.home}`);
    for (const notice of config.notices) logger.warn(notice);
    logger.info(`prefix "${config.prefix}" · ${config.ownerNumbers.length} owner number(s) configured`);

    const lock = acquireLock();
    if (!lock.ok) {
        logger.warn(`another CORTANA MINI instance is already running (pid ${lock.pid}) — refusing to start a second WhatsApp session`);
        process.exit(1);
    }

    try {
        await panel.start();
    } catch (error) {
        if (error.code === 'EADDRINUSE') {
            logger.warn(`port ${config.port} is already in use — another CORTANA MINI instance is running. Refusing to start a second WhatsApp session.`);
            releaseLock();
            process.exit(1);
        }
        logger.error('panel.listen', error);
    }

    try {
        await bot.start();
    } catch (error) {
        logger.error('startup', error);
    }

    logger.success('CORTANA MINI engine ready');

    if (bot.isPaired()) {
        logger.info('session already paired — waiting for connection');
        return;
    }

    const interactive = Boolean(process.stdin.isTTY) && String(process.env.PAIR_PROMPT || '').toLowerCase() !== 'off';
    if (!interactive) {
        logger.info(`not paired — open http://localhost:${config.port} to generate the pairing code`);
        return;
    }

    const phone = await pairingPrompt.promptForNumber();
    if (!phone) return;

    try {
        const result = await bot.requestPairing(phone);
        pairingPrompt.printPairingCode(result.code, phone, result.expiresInMs);
        const timer = setTimeout(() => {
            if (!bot.isPaired()) {
                logger.warn('pairing code expired — generate a new one from the panel or restart');
            }
        }, result.expiresInMs);
        if (timer.unref) timer.unref();
    } catch (error) {
        logger.error('pairing', error);
        logger.info(`fallback: open http://localhost:${config.port} and generate the code from the panel`);
    }
})();
