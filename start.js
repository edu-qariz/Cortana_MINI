#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Boot repair. Runs before anything from src/ is loaded: if a previous update
// left this folder incomplete, the last good build is put back. It cannot live
// in src/ because a missing src/ is exactly the failure being repaired.
// ---------------------------------------------------------------------------
const REQUIRED = ['start.js', 'package.json', path.join('src', 'config.js'), path.join('src', 'bot.js')];
const usable = (dir) => {
    try {
        return REQUIRED.every((name) => fs.existsSync(path.join(dir, name)));
    } catch {
        return false;
    }
};

if (!usable(__dirname)) {
    try {
        const base = path.basename(__dirname);
        const parent = path.dirname(__dirname);
        const candidates = fs.readdirSync(parent)
            .filter((name) => name.startsWith(`${base}.old-`))
            .sort()
            .reverse();
        for (const name of candidates) {
            const candidate = path.join(parent, name);
            if (!usable(candidate)) continue;
            try {
                const broken = `${__dirname}.broken-${Date.now()}`;
                if (fs.existsSync(__dirname)) fs.renameSync(__dirname, broken);
                fs.renameSync(candidate, __dirname);
                console.warn(`\n  ! previous update left this folder incomplete — restored ${name}\n`);
            } catch {
                // Windows refuses to rename the process working directory, so copy
                // whatever is missing instead of swapping folders.
                for (const entry of ['start.js', 'package.json', 'package-lock.json', 'src', 'tools', 'app.json', 'Procfile', 'README.md', '.env.example', 'LICENSE']) {
                    const from = path.join(candidate, entry);
                    const to = path.join(__dirname, entry);
                    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
                    try {
                        fs.cpSync(from, to, { recursive: true });
                    } catch { /* best effort */ }
                }
                console.warn(`\n  ! incomplete install — copied the missing files back from ${name}\n`);
            }
            break;
        }
    } catch (error) {
        console.warn(`\n  ! could not auto-repair: ${error.message}\n`);
    }
}

const config = require('./src/config');
const logger = require('./src/logger');
const store = require('./src/store');
const licence = require('./src/licence');
const update = require('./src/update');
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
    // Put the last good build back if a previous swap left the folder incomplete.
    update.repair();
    logger.info(`version ${config.versionLabel} · node ${process.version} · ${config.timezone}`);
    logger.info(`state dir ${config.paths.home}`);
    logger.info(`env ${config.envSources.length ? config.envSources.join(', ') : `none found at ${config.paths.env}`}`);
    for (const notice of config.notices) logger.warn(notice);
    logger.info(`prefix "${config.prefix}" · ${config.ownerNumbers.length} owner number(s) configured`);
    if (!licence.configured()) {
        logger.warn('no licence configured — commands will refuse to run');
        logger.warn(`create ${config.paths.env} with these two lines:`);
        logger.warn('  CORTANA_API=https://api.thecortana.tech');
        logger.warn(`  LICENCE_KEY=CM-XXXX-XXXX-XXXX   (ask for your key)`);
        logger.warn('then restart the server');
    }

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

    // Unattended client update: stage, swap, then exit so the supervisor restarts
    // into the new build. Command updates never need this — those come from the
    // service on every message.
    if (config.autoUpdate) {
        const attempt = async (label) => {
            try {
                const result = await update.autoApply();
                if (result.update) {
                    logger.success(`updated to ${result.version} — restarting into the new build`);
                    setTimeout(() => process.exit(0), 500);
                    return true;
                }
                if (result.code === 'manual_apply') {
                    logger.warn(`update ${result.version} staged — run: node tools/apply-update.js`);
                    return true;
                }
                logger.info(`update ${label}: already current (${result.version || config.version})`);
                return true;
            } catch (error) {
                const detail = [error.code, error.message].filter(Boolean).join(' · ');
                logger.warn(`auto-update ${label} failed: ${detail} — will retry in 15 minutes`);
                return false;
            }
        };

        const boot = setTimeout(() => attempt('check'), 30_000);
        if (boot.unref) boot.unref();

        // Keep trying: a panel that boots during a network blip must still catch up.
        const retry = setInterval(() => attempt('retry'), 15 * 60_000);
        if (retry.unref) retry.unref();
    }

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
