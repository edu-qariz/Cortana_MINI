'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const api = require('./api');
const config = require('./config');
const logger = require('./logger');
const releaseKeys = require('./release-key');
const { canonical } = require('./canonical');

const UPDATE_DIR = path.join(config.paths.home, 'update');
const PENDING_FILE = path.join(UPDATE_DIR, 'pending.json');
const STATE_ENTRIES = ['auth', 'data', 'logs', '.env', 'node_modules'];

function compareVersions(left, right) {
    const a = String(left).split('.').map(Number);
    const b = String(right).split('.').map(Number);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const diff = (a[index] || 0) - (b[index] || 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
}

function verifyManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') return { ok: false, code: 'manifest_invalid' };
    if (manifest.schema !== 1) return { ok: false, code: 'manifest_schema' };
    if (!releaseKeys.configured()) return { ok: false, code: 'no_release_key', error: 'no release public key is compiled in' };

    const signature = manifest.signature;
    if (!signature || signature.alg !== 'ed25519' || !signature.value) {
        return { ok: false, code: 'manifest_unsigned' };
    }
    const key = releaseKeys.publicKey(signature.keyId);
    if (!key) return { ok: false, code: 'release_key_unknown', error: `unknown keyId ${signature.keyId}` };

    const { signature: _ignored, ...payload } = manifest;
    try {
        const valid = crypto.verify(
            null,
            Buffer.from(canonical(payload), 'utf8'),
            key,
            Buffer.from(signature.value, 'base64')
        );
        return valid ? { ok: true, manifest } : { ok: false, code: 'manifest_signature_invalid' };
    } catch (error) {
        return { ok: false, code: 'manifest_signature_error', error: error.message };
    }
}

async function check() {
    const manifest = await api.get(`/v1/release/manifest?channel=${encodeURIComponent(config.channel)}`);
    const verified = verifyManifest(manifest);
    if (!verified.ok) return verified;

    if (manifest.minClient && compareVersions(manifest.minClient, config.version) > 0) {
        return { ok: false, code: 'reinstall_required', manifest };
    }
    const newer = compareVersions(manifest.version, config.version) > 0;
    return { ok: true, update: newer, manifest, current: config.version };
}

async function download(manifest) {
    const artifact = manifest.artifact || {};
    if (!artifact.url || !artifact.sha256) throw Object.assign(new Error('manifest has no artifact'), { code: 'artifact_missing' });

    fs.mkdirSync(UPDATE_DIR, { recursive: true });
    const file = path.join(UPDATE_DIR, `${manifest.version}.zip`);
    const response = await fetch(artifact.url);
    if (!response.ok) throw Object.assign(new Error(`download failed: HTTP ${response.status}`), { code: 'download_failed' });

    const bytes = Buffer.from(await response.arrayBuffer());
    if (artifact.size && bytes.length !== artifact.size) {
        throw Object.assign(new Error(`size mismatch (${bytes.length} != ${artifact.size})`), { code: 'size_mismatch' });
    }
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== String(artifact.sha256).toLowerCase()) {
        throw Object.assign(new Error('sha256 mismatch'), { code: 'hash_mismatch' });
    }

    fs.writeFileSync(file, bytes);
    return file;
}

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { windowsHide: true, ...options }, (error, stdout, stderr) => {
            if (error) reject(Object.assign(new Error(stderr || error.message), { code: 'command_failed' }));
            else resolve(stdout);
        });
    });
}

async function extract(zip, target) {
    try {
        await run('tar', ['-xf', zip, '-C', target]);
        return;
    } catch (error) {
        if (process.platform !== 'win32') throw error;
    }
    await run('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${target}' -Force`]);
}

async function stage(zip, manifest) {
    const staging = `${config.paths.root}.update-staging`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    await extract(zip, staging);

    for (const name of STATE_ENTRIES) {
        fs.rmSync(path.join(staging, name), { recursive: true, force: true });
    }

    await run(process.execPath, ['--check', 'start.js'], { cwd: staging });
    await run(process.execPath, ['-e', 'require("./src/config")'], {
        cwd: staging,
        env: { ...process.env, CORTANA_HOME: path.join(staging, '.smoke') },
    });
    fs.rmSync(path.join(staging, '.smoke'), { recursive: true, force: true });

    fs.mkdirSync(UPDATE_DIR, { recursive: true });
    fs.writeFileSync(
        PENDING_FILE,
        `${JSON.stringify({
            version: manifest.version,
            staging,
            zip,
            depsChanged: Boolean(manifest.deps && manifest.deps.changed),
            stagedAt: new Date().toISOString(),
        }, null, 2)}\n`,
        'utf8'
    );
    return { staging, pending: PENDING_FILE };
}

function pending() {
    try {
        return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    } catch {
        return null;
    }
}

function lockIsAlive() {
    try {
        const pid = Number(String(fs.readFileSync(path.join(config.paths.data, 'instance.lock'), 'utf8')).trim());
        if (!pid || pid === process.pid) return false;
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** Swaps the staged folder in. Must run with the bot stopped — see tools/apply-update.js. */
function apply() {
    const ready = pending();
    if (!ready) return { ok: false, code: 'nothing_staged' };
    if (!fs.existsSync(ready.staging)) return { ok: false, code: 'staging_missing' };
    if (lockIsAlive()) return { ok: false, code: 'bot_running' };

    const app = config.paths.root;
    const previous = `${app}.old-${ready.version}`;
    fs.rmSync(previous, { recursive: true, force: true });
    fs.renameSync(app, previous);
    try {
        fs.renameSync(ready.staging, app);
    } catch (error) {
        fs.renameSync(previous, app);
        throw error;
    }
    fs.rmSync(PENDING_FILE, { force: true });
    logger.success(`updated to ${ready.version} — previous build kept at ${previous}`);
    return { ok: true, app, previous, version: ready.version, depsChanged: ready.depsChanged };
}

module.exports = {
    compareVersions,
    verifyManifest,
    check,
    download,
    stage,
    apply,
    pending,
    PENDING_FILE,
};
