'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEGACY_ENTRIES = ['auth', 'data', 'logs', '.env'];
const MIGRATION_MARKER = '.migrated-from-code-dir';

function resolveHome() {
    const explicit = String(process.env.CORTANA_HOME || '').trim();
    if (explicit) return path.resolve(explicit);
    const localAppData = String(process.env.LOCALAPPDATA || '').trim();
    if (localAppData) return path.join(localAppData, 'CortanaMini');
    // Containers often set HOME without a matching /etc/passwd entry, so prefer it.
    const home = String(process.env.HOME || process.env.USERPROFILE || '').trim();
    if (home) return path.join(home, '.cortana-mini');
    return path.join(os.homedir(), '.cortana-mini');
}

function isSamePath(a, b) {
    const normalize = (value) => path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
    return normalize(a) === normalize(b);
}

function isEmptyDir(target) {
    try {
        return fs.statSync(target).isDirectory() && fs.readdirSync(target).length === 0;
    } catch {
        return false;
    }
}

function moveEntry(from, to) {
    if (!fs.existsSync(from)) return false;
    if (fs.existsSync(to)) {
        if (isEmptyDir(from) && isEmptyDir(to)) {
            fs.rmdirSync(to);
        } else {
            return false;
        }
    }
    try {
        fs.renameSync(from, to);
    } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        fs.cpSync(from, to, { recursive: true, force: true });
        fs.rmSync(from, { recursive: true, force: true });
    }
    return true;
}

// One-time move of pre-split runtime state out of the app folder, so a release
// swap can replace the app folder without destroying the WhatsApp session.
function migrateFromCodeDir(home) {
    const result = { moved: [], skipped: [], failed: [] };
    if (isSamePath(home, ROOT)) return result;

    try {
        fs.mkdirSync(home, { recursive: true });
    } catch (error) {
        result.failed.push({ name: 'home', error });
        return result;
    }

    for (const name of LEGACY_ENTRIES) {
        const from = path.join(ROOT, name);
        const to = path.join(home, name);
        if (!fs.existsSync(from)) continue;
        if (fs.existsSync(to) && !isEmptyDir(from)) {
            result.skipped.push(name);
            continue;
        }
        try {
            if (moveEntry(from, to)) result.moved.push(name);
            else result.skipped.push(name);
        } catch (error) {
            result.failed.push({ name, error });
        }
    }

    if (result.moved.length) {
        try {
            fs.writeFileSync(
                path.join(home, MIGRATION_MARKER),
                `${JSON.stringify({ from: ROOT, at: new Date().toISOString(), moved: result.moved }, null, 2)}\n`,
                'utf8'
            );
        } catch { /* the marker is informational only */ }
    }

    return result;
}

module.exports = { ROOT, MIGRATION_MARKER, resolveHome, migrateFromCodeDir };
