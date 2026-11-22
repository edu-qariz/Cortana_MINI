'use strict';

const commands = new Map();

function register(definition) {
    if (!definition?.name || typeof definition.execute !== 'function') {
        throw new Error(`Invalid command definition: ${definition?.name || 'unnamed'}`);
    }
    const def = {
        category: 'general',
        aliases: [],
        ownerOnly: false,
        adminOnly: false,
        groupOnly: false,
        hidden: false,
        ...definition,
    };
    commands.set(def.name, def);
    for (const alias of def.aliases || []) {
        if (!commands.has(alias)) commands.set(alias, def);
    }
    return def;
}

function find(name) {
    return commands.get(String(name || '').toLowerCase());
}

function all() {
    const unique = new Set(commands.values());
    return [...unique];
}

function publicList() {
    return all().filter((def) => !def.hidden);
}

function count() {
    return all().length;
}

module.exports = { register, find, all, publicList, count };
