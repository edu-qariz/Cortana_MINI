'use strict';

// Brand identity shared by every outgoing message. The newsletter context is what
// makes replies look like they come from a verified channel.
const BRAND = {
    newsletterJid: '120363424485406730@newsletter',
    newsletterName: 'CORTANA PRO MINI',
    serverMessageId: 143,
    signature: '✦ 𝐂𝐎𝐑𝐓𝐀𝐍𝐀 𝐏𝐑𝐎 𝐌𝐈𝐍𝐈 ✦',
    footer: '©2026 t.me/techdepro',
};

const FOOTER_BLOCK = `${BRAND.signature}\nèdûqarîz · ${BRAND.footer}`;

function brandContext(extra = {}) {
    return {
        isForwarded: true,
        forwardingScore: 999,
        forwardedNewsletterMessageInfo: { ...BRAND },
        ...extra,
    };
}

function brandedQuote() {
    return {
        key: {
            fromMe: false,
            participant: '0@s.whatsapp.net',
            remoteJid: 'status@broadcast',
        },
        message: {
            newsletterAdminInviteMessage: {
                newsletterJid: BRAND.newsletterJid,
                newsletterName: BRAND.newsletterName,
                jpegThumbnail: Buffer.alloc(0),
                caption: BRAND.footer,
                inviteExpiration: 0,
            },
        },
    };
}

function branded(content) {
    return { ...content, contextInfo: { ...brandContext(), ...(content.contextInfo || {}) } };
}

/** Appends the brand block once, so every reply is visibly branded. */
function withFooter(text) {
    const value = String(text || '');
    if (!value || value.includes(BRAND.footer)) return value;
    return `${value}\n\n${FOOTER_BLOCK}`;
}

module.exports = { BRAND, brandContext, brandedQuote, branded, withFooter };
