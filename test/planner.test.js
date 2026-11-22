'use strict';

const os = require('node:os');
const path = require('node:path');

process.env.CORTANA_HOME = path.join(os.tmpdir(), 'cm-test-planner');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const planner = require('../src/planner');

function makeCtx() {
    const replies = [];
    return {
        replies,
        chat: '120363000000000000@g.us',
        isOwner: true,
        isGroup: true,
        args: [],
        text: '',
        reply: async (content) => {
            replies.push(content);
            return {};
        },
        react: async () => ({}),
        groupMeta: async () => ({ id: 'g', subject: 'Group', participants: [{ id: '1@s.whatsapp.net', admin: 'superadmin' }] }),
        restart: async () => ({}),
        sock: {},
    };
}

test('resolve fills templates from step output and state', () => {
    const text = planner.resolve('{{s1.latencyMs}}ms / {{settings.botName}} / keep {{missing}}', {
        s1: { latencyMs: 12 },
        settings: { botName: 'CORTANA PRO MINI' },
    });
    assert.equal(text, '12ms / CORTANA PRO MINI / keep {{missing}}');
});

test('safePath refuses to escape the state folder', () => {
    assert.throws(() => planner.safePath('../../etc/passwd'), /state folder/);
    assert.ok(planner.safePath('data/tmp/file.bin').includes('data'));
});

test('run executes runtime then say with the metrics interpolated', async () => {
    const ctx = makeCtx();
    await planner.run(ctx, {
        schema: 1,
        steps: [
            { id: 's1', use: 'runtime', args: { op: 'metrics' } },
            { id: 's2', use: 'say', args: { text: 'v{{s1.version}} up {{s1.uptime}}' } },
        ],
    });
    assert.match(ctx.replies.at(-1), /^vV\d+\.\d+ up /);
});

test('run drops an expired plan without replying', async () => {
    const ctx = makeCtx();
    const handled = await planner.run(ctx, {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        steps: [{ use: 'say', args: { text: 'should not send' } }],
    });
    assert.equal(handled, false);
    assert.equal(ctx.replies.length, 0);
});

test('run rejects unknown primitives and over-long plans', async () => {
    await assert.rejects(() => planner.run(makeCtx(), { steps: [{ use: 'nope' }] }), /unknown primitive/);
    await assert.rejects(
        () => planner.run(makeCtx(), { steps: Array.from({ length: 9 }, () => ({ use: 'say', args: { text: 'x' } })) }),
        /max is 8/
    );
});

test('onError skip keeps the plan going', async () => {
    const ctx = makeCtx();
    await planner.run(ctx, {
        steps: [
            { use: 'query', args: { what: 'unsupported-thing' }, onError: 'skip' },
            { id: 'ok', use: 'say', args: { text: 'still here' } },
        ],
    });
    assert.equal(ctx.replies.at(-1), 'still here');
});
