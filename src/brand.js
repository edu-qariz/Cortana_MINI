'use strict';

// Brand identity. Only the text footer carries the brand: attaching a newsletter
// context made every reply wear a "View channel" chip, which the owner calls noise.
const BRAND = {
    signature: '✦ 𝐂𝐎𝐑𝐓𝐀𝐍𝐀 𝐏𝐑𝐎 𝐌𝐈𝐍𝐈 ✦',
    footer: '©2026 t.me/techdepro',
};

const FOOTER_BLOCK = `${BRAND.signature}\nèdûqarîz · ${BRAND.footer}`;

// Only the menu wears the channel chip. Everything else stays clean.
const CHANNEL = {
    newsletterJid: '120363424485406730@newsletter',
    newsletterName: 'CORTANA PRO MINI',
    serverMessageId: 143,
};

/** Newsletter context, opt-in per message (menu only). */
function channelContext() {
    return {
        isForwarded: true,
        forwardingScore: 999,
        forwardedNewsletterMessageInfo: { ...CHANNEL },
    };
}

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

/** Appends the brand block once. A bare copyright line also counts as branded by
 * the worker, so upgrade that to the full block instead of leaving it unbranded. */
function withFooter(text) {
    let value = String(text || '').trim();
    if (!value) return value;
    if (value.includes(BRAND.signature)) return value;
    const bare = `èdûqarîz · ${BRAND.footer}`;
    if (value.endsWith(bare)) value = value.slice(0, -bare.length).trimEnd();
    if (!value) return FOOTER_BLOCK;
    return `${value}\n\n${FOOTER_BLOCK}`;
}

module.exports = { BRAND, CHANNEL, channelContext, fakeQuote, brandedQuote, branded, withFooter };