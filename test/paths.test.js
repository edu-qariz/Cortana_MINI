'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { resolveHome } = require('../src/paths');

test('CORTANA_HOME wins when set', () => {
    const previous = process.env.CORTANA_HOME;
    process.env.CORTANA_HOME = path.join(os.tmpdir(), 'cm-home-explicit');
    assert.equal(resolveHome(), path.resolve(path.join(os.tmpdir(), 'cm-home-explicit')));
    process.env.CORTANA_HOME = previous;
});

test('LOCALAPPDATA is used when CORTANA_HOME is empty', () => {
    const previousHome = process.env.CORTANA_HOME;
    const previousLocal = process.env.LOCALAPPDATA;
    delete process.env.CORTANA_HOME;
    process.env.LOCALAPPDATA = 'C:\\Users\\tester\\AppData\\Local';
    assert.equal(resolveHome(), path.join('C:\\Users\\tester\\AppData\\Local', 'CortanaMini'));
    process.env.CORTANA_HOME = previousHome;
    process.env.LOCALAPPDATA = previousLocal;
});

test('falls back to the home directory', () => {
    const previousHome = process.env.CORTANA_HOME;
    const previousLocal = process.env.LOCALAPPDATA;
    delete process.env.CORTANA_HOME;
    delete process.env.LOCALAPPDATA;
    assert.equal(resolveHome(), path.join(os.homedir(), '.cortana-mini'));
    process.env.CORTANA_HOME = previousHome;
    process.env.LOCALAPPDATA = previousLocal;
});
