'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canonical } = require('../src/canonical');

test('canonical ignores key order', () => {
    const a = canonical({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } });
    const b = canonical({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 });
    assert.equal(a, b);
});

test('canonical produces no whitespace', () => {
    assert.equal(canonical({ a: 1, b: 'x y' }), '{"a":1,"b":"x y"}');
});

test('canonical normalises undefined to null', () => {
    assert.equal(canonical({ a: undefined }), '{"a":null}');
});
