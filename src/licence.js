'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const api = require('./api');
const config = require('./config');
const logger = require('./logger');

const CACHE_FILE = path.join(config.paths.home, 'license.json');
const REFRESH_WINDOW_MS = 120_000;

let token = '';
let cachedKey = '';
let payload = null;
let lastError = null;
let inflight = null;

function deviceId() {
    const materials = [os.hostname(), os.platform(), os.arch(), os.userInfo().username].join('|');
    return crypto.createHash('sha256').update(materials).digest('hex').slice(0, 24);
}

function decode(value) {
    const [body] = String(value || '').split('.');
    if (!body) return null;
    try {
        const parsed = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        return typeof parsed.exp === 'number' ? parsed : null;
    } catch {
        return null;
    }
}

function load() {
    try {
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        if (typeof cached.token === 'string') {
            token = cached.token;
            payload = decode(token);
        }
        if (typeof cached.licence === 'string') cachedKey = cached.licence;
    } catch { /* first run, or a corrupt cache the next verify will replace */ }
}

function save() {
    try {
        fs.writeFileSync(
            CACHE_FILE,
            `${JSON.stringify({ token, licence: cachedKey, device: deviceId(), savedAt: new Date().toISOString() }, null, 2)}\n`,
            'utf8'
        );
    } catch (error) {
        logger.warn(`could not cache the licence token: ${error.message}`);
    }
}

const configured = () => Boolean(config.apiBaseUrl);
const timeLeft = () => (payload ? payload.exp * 1000 - Date.now() : 0);

async function ensure({ force = false } = {}) {
    if (!configured()) return { ok: false, code: 'licence_unconfigured' };
    if (!force && token && timeLeft() > REFRESH_WINDOW_MS) return { ok: true, payload };
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            let key = config.licenceKey || cachedKey;
            if (!key) {
                // No key configured: let the service issue one bound to this device.
                const issued = await api.post('/v1/licence/auto', { device: deviceId() });
                key = String(issued.licence || '');
                if (!key) throw new api.ApiError('licence_bad_response', 'server returned no licence');
                cachedKey = key;
                save();
            }
            const data = await api.post('/v1/licence/verify', { licence: key, device: deviceId() });
            const fresh = String(data.token || '');
            const decoded = decode(fresh);
            if (!decoded) throw new api.ApiError('licence_bad_token', 'server returned an unusable token');
            token = fresh;
            payload = decoded;
            lastError = null;
            save();
            logger.info(`licence active · plan ${decoded.plan || 'pilot'}`);
            return { ok: true, payload: decoded };
        } catch (error) {
            lastError = error;
            const detail = `${error.code || 'error'}${error.message ? ` (${error.message})` : ''}`;
            logger.warn(`licence check failed: ${detail}`);
            return { ok: false, code: error.code || 'licence_error', error };
        } finally {
            inflight = null;
        }
    })();

    return inflight;
}

async function planFor(command, args, context) {
    const check = await ensure();
    if (!check.ok) return check;

    const send = () => api.post(
        '/v1/plan',
        { command, args, context },
        { headers: { authorization: `Bearer ${token}` } }
    );

    try {
        return { ok: true, data: await send() };
    } catch (error) {
        if (error.status !== 401) {
            return { ok: false, code: error.code || 'plan_error', error };
        }
        const retry = await ensure({ force: true });
        if (!retry.ok) return retry;
        try {
            return { ok: true, data: await send() };
        } catch (second) {
            return { ok: false, code: second.code || 'plan_error', error: second };
        }
    }
}

function reset() {
    token = '';
    cachedKey = '';
    payload = null;
    lastError = null;
    try {
        fs.rmSync(CACHE_FILE, { force: true });
    } catch { /* best effort */ }
}

function status() {
    return {
        configured: configured(),
        device: deviceId(),
        licence: cachedKey ? `${cachedKey.slice(0, 6)}…` : null,
        plan: payload ? payload.plan : null,
        expiresAt: payload ? new Date(payload.exp * 1000).toISOString() : null,
        secondsLeft: payload ? Math.max(0, Math.round(timeLeft() / 1000)) : 0,
        error: lastError ? lastError.code || 'error' : null,
    };
}

load();

module.exports = {
    deviceId,
    configured,
    ensure,
    planFor,
    status,
    reset,
};
