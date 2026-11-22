import { signToken, verifyToken, bearerToken } from './token.js';
import { buildPlan } from './plans.js';

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
};

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra },
});

const fail = (code, message, status = 400) => json({ ok: false, code, error: message }, status);

async function readJson(request) {
    const text = await request.text();
    if (!text) return {};
    if (text.length > 64 * 1024) throw Object.assign(new Error('body too large'), { status: 413, code: 'body_too_large' });
    try {
        return JSON.parse(text);
    } catch {
        throw Object.assign(new Error('invalid JSON body'), { status: 400, code: 'bad_json' });
    }
}

const dayKey = () => new Date().toISOString().slice(0, 10);

function loadLicence(env, id) {
    return env.DB
        .prepare('SELECT id, plan, status, device_id, daily_limit, expires_at FROM licences WHERE id = ?')
        .bind(id)
        .first();
}

function licenceProblem(row) {
    if (!row) return ['licence_unknown', 'unknown licence'];
    if (row.status !== 'active') return [`licence_${row.status}`, `licence is ${row.status}`];
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return ['licence_expired', 'licence expired'];
    return null;
}

async function verifyLicence(request, env) {
    const body = await readJson(request);
    const licence = String(body.licence || '').trim();
    const device = String(body.device || '').trim();
    if (!licence || !device) return fail('bad_request', 'licence and device are required');

    const row = await loadLicence(env, licence);
    const problem = licenceProblem(row);
    if (problem) return fail(problem[0], problem[1], 403);
    if (row.device_id && row.device_id !== device) {
        return fail('device_mismatch', 'this licence is already bound to another device', 403);
    }
    if (!row.device_id) {
        await env.DB.prepare('UPDATE licences SET device_id = ? WHERE id = ? AND device_id IS NULL')
            .bind(device, row.id)
            .run();
    }
    await env.DB
        .prepare("INSERT INTO devices (licence_id, device_id) VALUES (?, ?) ON CONFLICT(licence_id, device_id) DO UPDATE SET last_seen = datetime('now')")
        .bind(row.id, device)
        .run();

    const ttl = Math.max(300, Number(env.TOKEN_TTL_SECONDS) || 3600);
    const expiresAt = Math.floor(Date.now() / 1000) + ttl;
    const token = await signToken(env.LICENCE_SECRET, {
        lid: row.id,
        dev: device,
        plan: row.plan,
        limit: row.daily_limit,
        exp: expiresAt,
    });

    return json({ ok: true, token, expiresAt, plan: row.plan, dailyLimit: row.daily_limit });
}

async function plan(request, env) {
    const payload = await verifyToken(env.LICENCE_SECRET, bearerToken(request));
    if (!payload) return fail('unauthorized', 'missing or invalid licence token', 401);

    const row = await loadLicence(env, payload.lid);
    const problem = licenceProblem(row);
    if (problem) return fail(problem[0], problem[1], 403);

    const body = await readJson(request);
    const command = String(body.command || '').trim().toLowerCase().slice(0, 32);
    if (!command) return fail('bad_request', 'command is required');

    const day = dayKey();
    const usage = await env.DB
        .prepare('SELECT plans FROM usage_daily WHERE licence_id = ? AND day = ?')
        .bind(row.id, day)
        .first();
    const used = usage ? usage.plans : 0;
    if (row.daily_limit > 0 && used >= row.daily_limit) {
        return fail('quota_exceeded', 'daily command limit reached', 429);
    }

    const built = await buildPlan({ command, args: body.args || {}, context: body.context || {}, env });
    if (!built) return json({ ok: true, unsupported: true, command });

    await env.DB
        .prepare('INSERT INTO usage_daily (licence_id, day, plans) VALUES (?, ?, 1) ON CONFLICT(licence_id, day) DO UPDATE SET plans = plans + 1')
        .bind(row.id, day)
        .run();

    return json({
        ok: true,
        schema: 1,
        planId: crypto.randomUUID(),
        command,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        steps: built.steps,
        quota: { day, used: used + 1, limit: row.daily_limit },
    });
}

async function manifest(env) {
    const key = env.MANIFEST_KEY || 'release:manifest:stable';
    const raw = await env.CACHE.get(key);
    if (!raw) return fail('manifest_missing', 'no release published yet', 404);
    return new Response(raw, {
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'public, max-age=300',
            ...CORS,
        },
    });
}

export default {
    async fetch(request, env) {
        const { pathname } = new URL(request.url);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

        try {
            if (pathname === '/health') {
                return json({
                    ok: true,
                    service: 'cortana-mini-api',
                    channel: env.CHANNEL || 'stable',
                    time: new Date().toISOString(),
                });
            }
            if (pathname === '/v1/licence/verify' && request.method === 'POST') return verifyLicence(request, env);
            if (pathname === '/v1/plan' && request.method === 'POST') return plan(request, env);
            if (pathname === '/v1/release/manifest' && request.method === 'GET') return manifest(env);
            return fail('not_found', 'unknown route', 404);
        } catch (error) {
            const status = Number(error && error.status) || 500;
            return fail((error && error.code) || 'internal', (error && error.message) || 'internal error', status);
        }
    },
};
