#!/usr/bin/env node
'use strict';

// Applies a staged update. Run with the bot stopped:
//   node tools/apply-update.js

const update = require('../src/update');

const ready = update.pending();
if (!ready) {
    console.log('nothing is staged — run the update command from WhatsApp first, or download a release.');
    process.exit(1);
}

const result = update.apply();
if (!result.ok) {
    const hints = {
        bot_running: 'stop the bot first (Ctrl+C, then re-run this)',
        staging_missing: 'the staged folder is gone — run the update again',
        nothing_staged: 'no update is waiting',
    };
    console.error(`cannot apply ${ready.version}: ${result.code} — ${hints[result.code] || 'see logs'}`);
    process.exit(1);
}

console.log(`updated to ${result.version}`);
console.log(`previous build kept at ${result.previous}`);
if (result.depsChanged) {
    console.log('dependencies changed — run `npm install` inside the app folder before starting.');
}
