'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, resolveHome, migrateFromCodeDir } = require('./paths');

function loadDotEnv(file) {
    const out = {};
    if (!fs.existsSync(file)) return out;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        out[key] = value;
    }
    return out;
}

const home = resolveHome();
const migration = migrateFromCodeDir(home);
const homeEnvFile = path.join(home, '.env');
const legacyEnvFile = path.join(ROOT, '.env');
const homeEnv = loadDotEnv(homeEnvFile);
const legacyEnv = loadDotEnv(legacyEnvFile);
const fileEnv = { ...legacyEnv, ...homeEnv };

const notices = [];
if (migration.moved.length) {
    notices.push(`moved ${migration.moved.join(', ')} out of the app folder into ${home}`);
}
for (const name of migration.skipped) {
    if (name === '.env') continue;
    notices.push(`kept ${path.join(home, name)}; the legacy copy at ${path.join(ROOT, name)} was left untouched`);
}
for (const { name, error } of migration.failed) {
    notices.push(`could not move ${name} into ${home}: ${error.message}`);
}
if (Object.keys(legacyEnv).length > 0) {
    notices.push(Object.keys(homeEnv).length > 0
        ? `ignoring ${legacyEnvFile} because ${homeEnvFile} takes precedence`
        : `reading ${legacyEnvFile} (deprecated); move it to ${homeEnvFile} — an app-folder .env is lost on update`);
}

const env = (key, fallback = '') => {
    const value = process.env[key];
    if (value !== undefined && value !== '') return value;
    return fileEnv[key] !== undefined && fileEnv[key] !== '' ? fileEnv[key] : fallback;
};
const num = (key, fallback) => {
    const parsed = Number(env(key, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const authDir = env('AUTH_DIR', 'auth');
const paths = {
    // root is the replaceable app folder; everything the bot writes lives under home.
    root: ROOT,
    home,
    data: path.join(home, 'data'),
    auth: path.isAbsolute(authDir) ? authDir : path.join(home, authDir),
    logs: path.join(home, 'logs'),
    tmp: path.join(home, 'data', 'tmp'),
    state: path.join(home, 'data', 'state.json'),
    menuImage: path.join(home, 'data', 'menu.jpg'),
    env: homeEnvFile,
};

for (const dir of [paths.data, paths.auth, paths.logs, paths.tmp]) {
    fs.mkdirSync(dir, { recursive: true });
}

const ownerNumbers = String(env('OWNER_NUMBERS', ''))
    .split(',')
    .map((value) => value.replace(/[^0-9]/g, ''))
    .filter(Boolean);

const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

module.exports = {
    paths,
    notices,
    version: packageJson.version,
    versionLabel: `V${packageJson.version.split('.').slice(0, 2).join('.')}`,
    botName: env('BOT_NAME', 'CORTANA PRO MINI'),
    prefix: (env('PREFIX', '.') || '.').slice(0, 2),
    pairingCode: String(env('PAIRING_CODE', 'CORTANA2')).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8),
    newsApiKey: env('GNEWS_API_KEY', ''),
    ownerNumbers,
    port: num('PORT', 8099),
    panelToken: env('PANEL_TOKEN', ''),
    apiBaseUrl: env('CORTANA_API', '').replace(/\/+$/, ''),
    licenceKey: env('LICENCE_KEY', ''),
    channel: env('CHANNEL', 'stable'),
    apiTimeoutMs: num('API_TIMEOUT_MS', 15000),
    menuImageUrl: env('MENU_IMAGE', ''),
    rateLimitPer10s: num('RATE_LIMIT_PER_10S', 8),
    maxMediaBytes: num('MAX_MEDIA_MB', 48) * 1024 * 1024,
    aiMemoryTurns: num('AI_MEMORY_TURNS', 8),
    logLevel: env('LOG_LEVEL', 'info'),
    ai: {
        groqKey: env('GROQ_API_KEY', ''),
        groqModel: env('GROQ_MODEL', 'llama-3.3-70b-versatile'),
        openaiKey: env('OPENAI_API_KEY', ''),
        openaiModel: env('OPENAI_MODEL', 'gpt-4o-mini'),
        deepseekKey: env('DEEPSEEK_API_KEY', ''),
        deepseekModel: env('DEEPSEEK_MODEL', 'deepseek-chat'),
    },
    timezone: env('TZ', '') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
};
