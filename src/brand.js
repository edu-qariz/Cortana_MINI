'use strict';

// Brand identity shared by every outgoing message. The newsletter context is what
// makes replies look like they come from a verified channel.
const BRAND = {
    newsletterJid: '120363424485406730@newsletter',
    newsletterName: 'CORTANA PRO MINI',
    serverMessageId: 143,
    footer: '©2026 t.me/techdepro',
};

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

module.exports = { BRAND, brandContext, brandedQuote, branded };
