#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const mode = String(process.argv[2] || '').toLowerCase();
const keyDir = path.join(__dirname, 'keys');

if (mode === 'secret') {
    console.log(crypto.randomBytes(32).toString('hex'));
} else if (mode === 'release') {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(keyDir, { recursive: true });
    const privateFile = path.join(keyDir, 'release-private.pem');
    const publicFile = path.join(keyDir, 'release-public.pem');
    fs.writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(publicFile, publicKey.export({ type: 'spki', format: 'pem' }));

    console.log(`wrote ${privateFile}`);
    console.log(`wrote ${publicFile}`);
    console.log('');
    console.log('Paste the public key into src/release-key.js:');
    console.log('');
    console.log(fs.readFileSync(publicFile, 'utf8').trim());
    console.log('');
    console.log('Keep release-private.pem out of git and out of the Worker. Sign releases locally or in CI.');
} else {
    console.log('usage:');
    console.log('  node tools/keygen.js secret    # 32-byte hex for LICENCE_SECRET');
    console.log('  node tools/keygen.js release   # Ed25519 keypair for manifests');
}
