#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonical } = require('../src/canonical');

const manifestFile = process.argv[2];
const keyFile = process.argv[3] || path.join(__dirname, 'keys', 'release-private.pem');
const keyIdArg = process.argv.find((value) => value.startsWith('--key-id='));
const keyId = keyIdArg ? keyIdArg.slice('--key-id='.length) : 'release-2026';

if (!manifestFile) {
    console.log('usage: node tools/sign-manifest.js <manifest.json> [private-key.pem] [--key-id=release-2026]');
    process.exit(1);
}
if (!fs.existsSync(manifestFile) || !fs.existsSync(keyFile)) {
    console.error('manifest or private key not found');
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
delete manifest.signature;

const privateKey = crypto.createPrivateKey(fs.readFileSync(keyFile, 'utf8'));
const signature = crypto.sign(null, Buffer.from(canonical(manifest), 'utf8'), privateKey);

const signed = {
    ...manifest,
    signature: { alg: 'ed25519', keyId, value: signature.toString('base64') },
};

const output = `${JSON.stringify(signed, null, 2)}\n`;
fs.writeFileSync(manifestFile.replace(/\.json$/i, '.signed.json'), output, 'utf8');
process.stdout.write(output);
