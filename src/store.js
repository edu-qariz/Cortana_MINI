'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

const DEFAULT_SETTINGS = {
    prefix: config.prefix,
    botName: config.botName,
    mode: 'public',
    menuImage: config.menuImageUrl || '',
};

const DEFAULT_CHAT = {
    antilink: 'off',
    antimention: 'off',
    antimentionLimit: 5,
    antispam: 'off',
    antileft: 'off',
    antidelete: 'off',
    welcome: 'off',
    welcomeText: '👋 Welcome {name} to *{group}*!',
    chatbot: 'off',
    warns: {},
};

const state = {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    chats: {},
    contacts: [],
    stats: {
        messages: 0,
        commands: 0,
        startedAt: Date.now(),
        lastConnectedAt: null,
    },
};

let contacts = new Set();
let saveTimer = null;
let dirty = false;

function mergeDefaults(target, defaults) {
    for (const [key, value] of Object.entries(defaults)) {
        if (target[key] === undefined) target[key] = value;
    }
    return target;
}

function load() {
    try {
        if (fs.existsSync(config.paths.state)) {
            const parsed = JSON.parse(fs.readFileSync(config.paths.state, 'utf8'));
            Object.assign(state.settings, mergeDefaults(parsed.settings || {}, DEFAULT_SETTINGS));
            if (state.settings.botName === 'CORTANA MINI') state.settings.botName = 'CORTANA PRO MINI';
            state.chats = parsed.chats || {};
            for (const chat of Object.values(state.chats)) mergeDefaults(chat, DEFAULT_CHAT);
            if (Array.isArray(parsed.contacts)) contacts = new Set(parsed.contacts.slice(-5000));
            Object.assign(state.stats, parsed.stats || {});
        }
    } catch (error) {
        logger.error('store.load', error);
    }
    state.stats.startedAt = Date.now();
    for (const jid of contacts) state.contacts = [...contacts];
}

function saveNow() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    try {
        const payload = {
            ...state,
            contacts: [...contacts].slice(-5000),
            stats: { ...state.stats },
        };
        const tmp = `${config.paths.state}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
        fs.renameSync(tmp, config.paths.state);
        dirty = false;
    } catch (error) {
        logger.error('store.save', error);
    }
}

function saveSoon(delay = 900) {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveNow();
    }, delay);
    if (saveTimer.unref) saveTimer.unref();
}

function getSettings() {
    return state.settings;
}

function updateSettings(patch) {
    Object.assign(state.settings, patch);
    saveSoon();
    return state.settings;
}

function getChat(jid) {
    if (!jid) return { ...DEFAULT_CHAT, warns: {} };
    if (!state.chats[jid]) {
        const keys = Object.keys(state.chats);
        if (keys.length >= 5000) delete state.chats[keys[0]];
        state.chats[jid] = { ...DEFAULT_CHAT, warns: {} };
    }
    const chat = state.chats[jid];
    mergeDefaults(chat, DEFAULT_CHAT);
    if (!chat.warns || typeof chat.warns !== 'object') chat.warns = {};
    return chat;
}

function updateChat(jid, patch) {
    const chat = getChat(jid);
    Object.assign(chat, patch);
    saveSoon();
    return chat;
}

function addWarn(jid, userJid) {
    const chat = getChat(jid);
    chat.warns[userJid] = (chat.warns[userJid] || 0) + 1;
    saveSoon();
    return chat.warns[userJid];
}

function resetWarns(jid, userJid) {
    const chat = getChat(jid);
    if (userJid) delete chat.warns[userJid];
    else chat.warns = {};
    saveSoon();
    return 0;
}

function addContact(jid) {
    if (!jid || !jid.includes('@s.whatsapp.net')) return;
    if (contacts.has(jid)) return;
    contacts.add(jid);
    if (contacts.size > 5000) {
        const first = contacts.values().next().value;
        contacts.delete(first);
    }
}

function contactList() {
    return [...contacts];
}

function bump(field, amount = 1) {
    state.stats[field] = (state.stats[field] || 0) + amount;
    if (field === 'messages' && state.stats[field] % 25 === 0) saveSoon();
}

function snapshot() {
    return {
        settings: { ...state.settings },
        stats: { ...state.stats },
        chats: Object.keys(state.chats).length,
        contacts: contacts.size,
        dirty,
    };
}

function flush() {
    saveNow();
}

module.exports = {
    DEFAULT_CHAT,
    DEFAULT_SETTINGS,
    state,
    load,
    saveNow,
    saveSoon,
    flush,
    getSettings,
    updateSettings,
    getChat,
    updateChat,
    addWarn,
    resetWarns,
    addContact,
    contactList,
    bump,
    snapshot,
};
