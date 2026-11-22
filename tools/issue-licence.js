#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const args = process.argv.slice(2);
const flag = (name, fallback = '') => {
    const found = args.find((value) => value.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : fallback;
};

const note = flag('note', 'pilot');
const days = Number(flag('days', '0'));
const limit = Number(flag('limit', '0'));

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const block = (size) => Array.from(crypto.randomBytes(size))
    .map((byte) => alphabet[byte % alphabet.length])
    .join('');

const licence = `CM-${block(4)}-${block(4)}-${block(4)}`;
const expires = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;

console.log('licence key:');
console.log(`  ${licence}`);
console.log('');
console.log('D1 statement (run once the Worker is deployed):');
console.log(
    `npx wrangler d1 execute cortana-mini --remote --command "INSERT INTO licences (id, plan, status, daily_limit, expires_at, note) `
    + `VALUES ('${licence}', 'pilot', 'active', ${Number.isFinite(limit) ? limit : 0}, ${expires ? `'${expires}'` : 'NULL'}, '${note.replace(/'/g, "''")}')"`
);
console.log('');
console.log('Give the key to the client as LICENCE_KEY in its state-folder .env.');
console.log('daily_limit = 0 means unlimited; the usage counter still runs.');
