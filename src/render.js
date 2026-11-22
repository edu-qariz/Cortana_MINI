'use strict';

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

// Fake newsletter mention used by the main MD bot for verified branding.
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

async function sendBranded(ctx, content, options = {}) {
    return ctx.send(branded(content), { quoted: brandedQuote(), ...options });
}

async function sendLoading(ctx, text) {
    return ctx.send(branded({ text: `⏳ ${text}` }));
}

async function editOrSend(ctx, sent, text, extra = {}) {
    if (sent?.key) {
        try {
            await ctx.sock.sendMessage(ctx.chat, { ...extra, text, edit: sent.key });
            return sent;
        } catch { /* fall through to a normal send */ }
    }
    return sendBranded(ctx, { ...extra, text });
}

function newsCaption(article, extra = '') {
    const lines = [];
    if (article.title) lines.push(`*${article.title}*`);
    if (article.description) lines.push(article.description);
    if (extra) lines.push(extra);
    if (article.url) lines.push(`🔗 ${article.url}`);
    const meta = [article.source, article.publishedAt].filter(Boolean).join(' · ');
    if (meta) lines.push(`_${meta}_`);
    return lines.join('\n\n');
}

module.exports = { BRAND, brandContext, brandedQuote, branded, sendBranded, sendLoading, editOrSend, newsCaption };
