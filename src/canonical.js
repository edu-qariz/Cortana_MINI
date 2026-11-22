'use strict';

/**
 * Deterministic JSON: keys sorted recursively, no insignificant whitespace.
 * The release signer and the client verifier must agree on these exact bytes.
 */
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        const body = Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
            .join(',');
        return `{${body}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

module.exports = { canonical };
