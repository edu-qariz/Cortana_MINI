'use strict';

const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const config = require('./config');
const logger = require('./logger');

/**
 * Relays a document the licence server rendered. This file builds no payload of its
 * own: the worker returns the whole stanza shape with the HTML already inside it.
 */
function envelope(body) {
    const message = body && typeof body === 'object' ? body.message : null;
    if (!message) throw new Error('sendHtmlMessage: the plan did not supply a message');
    return message;
}

async function sendHtmlMessage(sock, jid, body) {
    if (!sock || !jid) throw new Error('sendHtmlMessage: sock and jid are required');
    const content = envelope(typeof body === 'string' ? null : body);
    const msg = generateWAMessageFromContent(jid, content, {});
    await sock.relayMessage(jid, msg.message, {
        messageId: msg.key.id,
        additionalNodes: [
            {
                tag: 'biz',
                attrs: {},
                content: [
                    {
                        tag: 'interactive',
                        attrs: { type: 'native_flow', v: '1' },
                        content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
                    },
                ],
            },
        ],
    });
    logger.outgoing({ chat: jid, kind: 'html', preview: 'html surface', ms: 0 });
    return msg;
}

module.exports = { sendHtmlMessage, apiBase: config.apiBaseUrl };