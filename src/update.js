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

const REQUIRED = ['start.js', 'package.json', path.join('src', 'config.js'), path.join('src', 'bot.js')];

// Minimal stored/deflate zip reader used when the host has no unzip or tar.
const UNZIP_SCRIPT = `
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const [zipPath, outDir] = process.argv.slice(2);
const buf = fs.readFileSync(zipPath);
const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
if (eocd < 0) throw new Error('not a zip file');
const count = buf.readUInt16LE(eocd + 10);
let off = buf.readUInt32LE(eocd + 16);
for (let i = 0; i < count; i += 1) {
  if (buf.readUInt32LE(off) !== 0x02014b50) break;
  const method = buf.readUInt16LE(off + 10);
  const compSize = buf.readUInt32LE(off + 20);
  const nameLen = buf.readUInt16LE(off + 28);
  const extraLen = buf.readUInt16LE(off + 30);
  const commentLen = buf.readUInt16LE(off + 32);
  const localOff = buf.readUInt32LE(off + 42);
  const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
  off += 46 + nameLen + extraLen + commentLen;
  if (name.endsWith('/')) { fs.mkdirSync(path.join(outDir, name), { recursive: true }); continue; }
  const localNameLen = buf.readUInt16LE(localOff + 26);
  const localExtraLen = buf.readUInt16LE(localOff + 28);
  const start = localOff + 30 + localNameLen + localExtraLen;
  const raw = buf.subarray(start, start + compSize);
  const data = method === 0 ? raw : zlib.inflateRawSync(raw);
  const target = path.join(outDir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}
`;

function verifyTree(dir) {
    for (const name of REQUIRED) {
        if (!fs.existsSync(path.join(dir, name))) {
            throw Object.assign(new Error(`incomplete release: ${name} is missing`), { code: 'incomplete_release' });
        }
    }
}

async function extract(zip, target) {
    const attempts = [];
    if (process.platform === 'win32') {
        attempts.push(['powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${target}' -Force`]]);
        attempts.push(['tar', ['-xf', zip, '-C', target]]);
    } else {
        attempts.push(['unzip', ['-q', '-o', zip, '-d', target]]);
        attempts.push(['tar', ['-xf', zip, '-C', target]]);
        attempts.push(['busybox', ['unzip', '-o', zip, '-d', target]]);
    }
    // Last resort: unpack with Node itself, so a container without unzip/tar still works.
    attempts.push([process.execPath, ['-e', UNZIP_SCRIPT, zip, target]]);

    let lastError = null;
    for (const [command, args] of attempts) {
        try {
            await run(command, args);
            verifyTree(target);
            return;
        } catch (error) {
            if (error.code === 'incomplete_release') {
                // Extracted, but not a usable app: clear it and try the next tool.
                fs.rmSync(target, { recursive: true, force: true });
                fs.mkdirSync(target, { recursive: true });
                lastError = error;
                continue;
            }
            lastError = error;
        }
    }
    throw Object.assign(new Error(`could not unpack the release: ${lastError && lastError.message}`), { code: 'extract_failed' });
}

/** Staging must live on the same volume as the app folder, but panels mount only the app. */
function stagingDir() {
    const candidates = [
        `${config.paths.root}.update-staging`,
        path.join(config.paths.home, 'update', 'staging'),
        path.join(config.paths.root, '.update-staging'),
    ];
    for (const dir of candidates) {
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.accessSync(dir, fs.constants.W_OK);
            return dir;
        } catch { /* try the next location */ }
    }
    throw Object.assign(new Error('no writable staging directory'), { code: 'staging_unwritable' });
}

async function stage(zip, manifest) {
    const staging = stagingDir();
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    await extract(zip, staging);

    for (const name of STATE_ENTRIES) {
        fs.rmSync(path.join(staging, name), { recursive: true, force: true });
    }

    // Nothing is allowed to touch the live folder unless the new one proves it boots.
    verifyTree(staging);
    await run(process.execPath, ['--check', 'start.js'], { cwd: staging });
    await run(process.execPath, ['-e', 'require("./src/config")'], {
        cwd: staging,
        env: { ...process.env, CORTANA_HOME: path.join(staging, '.smoke') },
    });
    fs.rmSync(path.join(staging, '.smoke'), { recursive: true, force: true });
    verifyTree(staging);

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

function isUsable(dir) {
    try {
        return REQUIRED.every((name) => fs.existsSync(path.join(dir, name)));
    } catch {
        return false;
    }
}

/**
 * If a previous swap left the app folder incomplete, put the last good build back.
 * Runs before anything else touches the filesystem.
 */
function repair() {
    const app = config.paths.root;
    if (isUsable(app)) return null;

    const parent = path.dirname(app);
    const base = path.basename(app);
    let candidates = [];
    try {
        candidates = fs.readdirSync(parent)
            .filter((name) => name.startsWith(`${base}.old-`))
            .sort()
            .reverse();
    } catch {
        return null;
    }

    for (const name of candidates) {
        const dir = path.join(parent, name);
        if (!isUsable(dir)) continue;
        const broken = `${app}.broken-${Date.now()}`;
        try {
            if (fs.existsSync(app)) fs.renameSync(app, broken);
            fs.renameSync(dir, app);
            logger.warn(`restored ${name} — the previous update left the app folder incomplete`);
            return { ok: true, restored: name, broken };
        } catch (error) {
            logger.error('update.repair', error);
            return null;
        }
    }
    return null;
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
function apply({ allowSelf = false } = {}) {
    const ready = pending();
    if (!ready) return { ok: false, code: 'nothing_staged' };
    if (!fs.existsSync(ready.staging)) return { ok: false, code: 'staging_missing' };
    if (!allowSelf && lockIsAlive()) return { ok: false, code: 'bot_running' };

    try {
        verifyTree(ready.staging);
    } catch (error) {
        fs.rmSync(PENDING_FILE, { force: true });
        return { ok: false, code: 'incomplete_release', error: error.message };
    }

    const app = config.paths.root;
    const previous = `${app}.old-${ready.version}`;
    fs.rmSync(previous, { recursive: true, force: true });
    try {
        // Release our own lock first so the restarted process does not see a stale PID.
        fs.rmSync(path.join(config.paths.data, 'instance.lock'), { force: true });
    } catch { /* best effort */ }
    fs.renameSync(app, previous);
    try {
        fs.renameSync(ready.staging, app);
    } catch (error) {
        fs.renameSync(previous, app);
        throw error;
    }

    // Dependencies did not change, so move them across instead of forcing a rebuild
    // (native modules make a reinstall slow and fragile on panels).
    if (!ready.depsChanged) {
        const from = path.join(previous, 'node_modules');
        const to = path.join(app, 'node_modules');
        if (fs.existsSync(from) && !fs.existsSync(to)) {
            try {
                fs.renameSync(from, to);
            } catch { /* the supervisor will reinstall if this fails */ }
        }
    }

    fs.rmSync(PENDING_FILE, { force: true });
    logger.success(`updated to ${ready.version} — previous build kept at ${previous}`);
    return { ok: true, app, previous, version: ready.version, depsChanged: ready.depsChanged };
}

/**
 * Unattended update: fetch, verify, stage and swap, then exit so the supervisor
 * (pm2, panel, systemd) starts the new build. Windows cannot rename a running
 * folder, so there it stages and waits for the owner instead.
 */
async function autoApply() {
    if (!config.autoUpdate) return { ok: false, code: 'disabled' };
    const status = await check();
    if (!status.ok) return status;
    if (!status.update) return { ok: true, update: false, version: config.version };

    const manifest = status.manifest;
    const zip = await download(manifest);
    await stage(zip, manifest);

    if (process.platform === 'win32') {
        return { ok: false, code: 'manual_apply', version: manifest.version };
    }

    const result = apply({ allowSelf: true });
    if (!result.ok) return result;

    if (result.depsChanged) {
        const { execFile } = require('child_process');
        await new Promise((resolve) => {
            execFile('npm', ['install', '--omit=dev'], { cwd: result.app, windowsHide: true }, () => resolve());
        });
    }
    return { ok: true, update: true, version: manifest.version };
}

module.exports = {
    compareVersions,
    verifyManifest,
    check,
    download,
    stage,
    apply,
    autoApply,
    repair,
    pending,
    PENDING_FILE,
};
