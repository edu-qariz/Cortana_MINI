'use strict';

const os = require('node:os');
const path = require('node:path');

process.env.CORTANA_HOME = path.join(os.tmpdir(), 'cm-test-manifest');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { canonical } = require('../src/canonical');

const pair = crypto.generateKeyPairSync('ed25519');
process.env.CORTANA_RELEASE_KEY = pair.publicKey.export({ type: 'spki', format: 'pem' });
process.env.CORTANA_RELEASE_KEY_ID = 'release-2026';

const update = require('../src/update');

const BASE = {
    schema: 1,
    version: '2.4.0',
    channel: 'stable',
    minClient: '2.3.0',
    artifact: { url: 'https://example.test/a.zip', size: 10, sha256: 'a'.repeat(64) },
    deps: { changed: false },
};

function signed(payload, keyId = 'release-2026') {
    const signature = crypto.sign(null, Buffer.from(canonical(payload), 'utf8'), pair.privateKey);
    return { ...payload, signature: { alg: 'ed25519', keyId, value: signature.toString('base64') } };
}

test('a correctly signed manifest verifies', () => {
    assert.equal(update.verifyManifest(signed(BASE)).ok, true);
});

test('a tampered manifest is rejected', () => {
    const manifest = signed(BASE);
    manifest.version = '9.9.9';
    const result = update.verifyManifest(manifest);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'manifest_signature_invalid');
});

test('an unsigned manifest is rejected', () => {
    assert.equal(update.verifyManifest(BASE).code, 'manifest_unsigned');
});

test('an unknown key id is rejected', () => {
    assert.equal(update.verifyManifest(signed(BASE, 'other-key')).code, 'release_key_unknown');
});

test('version comparison handles majors and padding', () => {
    assert.equal(update.compareVersions('2.4.0', '2.3.9'), 1);
    assert.equal(update.compareVersions('2.3', '2.3.0'), 0);
    assert.equal(update.compareVersions('2.10.0', '2.9.9'), 1);
});
