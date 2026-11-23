'use strict';

// Brand identity. Branding rides on the fake "status" quote bubble, exactly like the
// main bot: replies themselves stay clean, no footer stamped on every message.
const BRAND = {
    signature: '✦ 𝐂𝐎𝐑𝐓𝐀𝐍𝐀 𝐏𝐑𝐎 𝐌𝐈𝐍𝐈 ✦',
    footer: '©2026 t.me/techdepro',
    dev: 'èdûqarîz',
};

/** The branding line that lives inside the quoted status bubble. */
const QUOTE_TEXT = `${BRAND.signature} · ${BRAND.dev} ${BRAND.footer}`;

/** Replies ship untouched — no forwarding, no channel card, no badge. */
function branded(content) {
    return content;
}

/** status@broadcast bubble carrying the branding line, so replies show a status chip. */
function fakeQuote(text = QUOTE_TEXT) {
    return {
        key: {
            fromMe: false,
            participant: '0@s.whatsapp.net',
            remoteJid: 'status@broadcast',
        },
        message: { conversation: String(text || QUOTE_TEXT) },
    };
}

function brandedQuote() {
    return fakeQuote();
}

/**
 * Channel chip, opt-in per message. The plan supplies the channel identity so no
 * newsletter id lives in the public tree.
 */
function channelContext(info = {}) {
    const jid = String((info && info.jid) || '');
    if (!jid) return {};
    return {
        isForwarded: true,
        forwardingScore: 999,
        forwardedNewsletterMessageInfo: {
            newsletterJid: jid,
            newsletterName: String(info.name || 'CORTANA PRO MINI'),
            serverMessageId: Number(info.id) || 143,
        },
    };
}

/**
 * Strips a trailing bare copyright line so plan text does not double up branding.
 * Branding is the quote bubble now, so nothing is appended.
 */
function withFooter(text) {
    let value = String(text || '').trim();
    if (!value) return value;
    const bare = `${BRAND.dev} · ${BRAND.footer}`;
    if (value.endsWith(bare)) value = value.slice(0, -bare.length).trimEnd();
    if (value.endsWith(BRAND.footer)) value = value.slice(0, -BRAND.footer.length).trimEnd();
    return value.replace(/[\s·]+$/, '');
}

module.exports = { BRAND, fakeQuote, brandedQuote, branded, channelContext, withFooter };