'use strict';

// Public keys that may sign a release manifest. Private keys never ship: they live
// in tools/keys/ (git-ignored) or CI secrets and are used by tools/sign-manifest.js.
//
// After running `node tools/keygen.js release`, paste the contents of
// tools/keys/release-public.pem below as a template literal. CORTANA_RELEASE_KEY
// overrides it at runtime, which is how tests and key rotation use it.
const crypto = require('crypto');

const KEYS = {
    // 'release-2026': `-----BEGIN PUBLIC KEY-----
    // MCowBQYDK2VwAyEA...
    // -----END PUBLIC KEY-----`,
};

function inlineKey() {
    const pem = String(process.env.CORTANA_RELEASE_KEY || '').trim();
    if (!pem) return null;
    const keyId = String(process.env.CORTANA_RELEASE_KEY_ID || 'release-2026').trim();
    return { keyId, pem };
}

const configured = () => Object.keys(KEYS).length > 0 || Boolean(inlineKey());

function publicKey(keyId) {
    const inline = inlineKey();
    const pem = KEYS[keyId] || (inline && inline.keyId === keyId ? inline.pem : null);
    if (!pem) return null;
    try {
        return crypto.createPublicKey(pem);
    } catch {
        return null;
    }
}

module.exports = { KEYS, configured, publicKey };
