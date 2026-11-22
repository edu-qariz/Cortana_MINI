'use strict';

// Brand identity. Only the text footer carries the brand: attaching a newsletter
// context made every reply wear a "View channel" chip, which the owner calls noise.
const BRAND = {
    signature: '✦ 𝐂𝐎𝐑𝐓𝐀𝐍𝐀 𝐏𝐑𝐎 𝐌𝐈𝐍𝐈 ✦',
    footer: '©2026 t.me/techdepro',
};

const FOOTER_BLOCK = `${BRAND.signature}\nèdûqarîz · ${BRAND.footer}`;

/** Replies ship untouched — no forwarding, no channel card, no badge. */
function branded(content) {
    return content;
}

/** Plain quote bubble so the reply still reads as a reply, with nothing attached. */
function fakeQuote(text = '') {
    return {
        key: {
            fromMe: false,
            participant: '0@s.whatsapp.net',
            remoteJid: 'status@broadcast',
        },
        message: { conversation: String(text || ' ') },
    };
}

/** Kept so older call sites keep working; it is the same plain bubble now. */
function brandedQuote() {
    return fakeQuote();
}

/** Appends the brand block once, so every reply is visibly branded. */
function withFooter(text) {
    const value = String(text || '');
    if (!value || value.includes(BRAND.footer)) return value;
    return `${value}\n\n${FOOTER_BLOCK}`;
}

module.exports = { BRAND, fakeQuote, brandedQuote, branded, withFooter };