'use strict';

const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const { brandContext } = require('./render');

async function sendSelectionCard(sock, jid, { title, body, footer, selectTitle, sections, cancelId = 'cancel' }) {
    const buttons = [
        { name: 'single_select', buttonParamsJson: JSON.stringify({ title: selectTitle, sections }) },
        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '❌ Cancel', id: cancelId }) },
    ];
    const card = {
        header: { title, subtitle: '', hasMediaAttachment: false },
        body: { text: body || ' ' },
        footer: { text: footer || '©2026 The Cortana Tech' },
        nativeFlowMessage: { messageParamsJson: JSON.stringify({}), buttons },
        contextInfo: brandContext(),
    };
    const message = generateWAMessageFromContent(jid, { interactiveMessage: card }, {});
    await sock.relayMessage(jid, message.message, {
        messageId: message.key.id,
        additionalNodes: [{
            tag: 'biz',
            attrs: {},
            content: [{
                tag: 'interactive',
                attrs: { type: 'native_flow', v: '1' },
                content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
            }],
        }],
    });
    return message;
}

module.exports = { sendSelectionCard };
