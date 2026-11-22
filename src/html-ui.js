'use strict';

const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const config = require('./config');
const logger = require('./logger');

/**
 * Sends a full HTML document as WhatsApp's built-in HTML surface.
 *
 *  forwarded — botForwardedMessage envelope + contextInfo {isForwarded, forwardOrigin}
 *  clean     — same envelope, not marked as forwarded
 *  bare      — no envelope at all
 */
function variant() {
    const value = String(process.env.HTML_UI_VARIANT || 'forwarded').toLowerCase();
    return ['forwarded', 'clean', 'bare'].includes(value) ? value : 'forwarded';
}

async function sendHtmlMessage(sock, jid, html, shape = variant()) {
    if (!sock || !jid) throw new Error('sendHtmlMessage: sock and jid are required');
    if (!html || !html.trim()) throw new Error('sendHtmlMessage: html payload is empty');

    const payload = {
        __typename: 'GenAIUnifiedResponse',
        response_id: require('crypto').randomUUID(),
        sections: [{
            __typename: 'GenAIUnifiedResponseSection',
            view_model: {
                __typename: 'GenAISingleLayoutViewModel',
                primitive: {
                    __typename: 'FOAHtmlPrimitiveDemoDONOTUSE',
                    trusted_sources: [],
                    payload: html.trim(),
                },
            },
        }],
    };

    const richResponseMessage = {
        messageType: 1,
        unifiedResponse: { data: Buffer.from(JSON.stringify(payload)).toString('base64') },
    };

    let content;
    if (shape === 'forwarded') {
        richResponseMessage.contextInfo = { isForwarded: true, forwardOrigin: 4 };
        content = { botForwardedMessage: { message: { richResponseMessage } } };
    } else if (shape === 'clean') {
        content = { botForwardedMessage: { message: { richResponseMessage } } };
    } else {
        content = { richResponseMessage };
    }

    const msg = generateWAMessageFromContent(jid, content, {});
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
    logger.outgoing({ chat: jid, kind: 'html', preview: `html ${Math.round(html.length / 1024)}KB`, ms: 0 });
    return msg;
}

module.exports = { sendHtmlMessage, variant, apiBase: config.apiBaseUrl };
