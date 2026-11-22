'use strict';

const crypto = require('crypto');
const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const config = require('./config');
const logger = require('./logger');

const BASE_CSS = `
:root{
  --bg:#090305;--card:rgba(20,8,16,.90);--txt:#f6eef3;--dim:#b9a6b2;
  --line:rgba(255,255,255,.10);--glass:rgba(255,255,255,.045);
  --acc:#db2777;--warn:#fbbf24;--grad:linear-gradient(135deg,#db2777,#7c3aed);
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;min-height:100%}
body{
  background:radial-gradient(900px 500px at 20% -10%,#2a0b1d 0%,#090305 55%);
  color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  font-size:14px;line-height:1.45;padding:14px 12px calc(18px + env(safe-area-inset-bottom));overflow-x:hidden;
}
.wrap{max-width:430px;margin:0 auto}
.card{
  background:linear-gradient(165deg,rgba(34,12,26,.92),rgba(12,4,10,.92));
  border:1px solid var(--line);border-radius:16px;padding:14px;
  box-shadow:0 12px 30px rgba(0,0,0,.45);
}
.title{font-size:15px;font-weight:900;letter-spacing:1px}
.sub{font-size:11.5px;color:var(--dim);margin-top:3px}
.foot{text-align:center;font-size:10px;color:var(--dim);opacity:.75;margin-top:14px;letter-spacing:.5px}
button{font-family:inherit}
@media(max-width:360px){body{padding:10px 8px}}
`;

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function htmlPage({ title = 'Cortana', css = '', body = '', script = '' }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#090305">
<title>${esc(title)}</title>
<style>${BASE_CSS}${css}</style>
</head>
<body>
<div class="wrap">${body}</div>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

async function sendHtmlMessage(sock, jid, html, variant = config.htmlUiVariant) {
    if (!sock || !jid) throw new Error('sendHtmlMessage: sock and jid are required');
    if (!html || !html.trim()) throw new Error('sendHtmlMessage: empty payload');

    const payload = {
        __typename: 'GenAIUnifiedResponse',
        response_id: crypto.randomUUID(),
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
        unifiedResponse: {
            data: Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
    };

    let content;
    if (variant === 'forwarded') {
        richResponseMessage.contextInfo = { isForwarded: true, forwardOrigin: 4 };
        content = { botForwardedMessage: { message: { richResponseMessage } } };
    } else if (variant === 'clean') {
        content = { botForwardedMessage: { message: { richResponseMessage } } };
    } else {
        content = { richResponseMessage };
    }

    const message = generateWAMessageFromContent(jid, content, {});
    logger.debug(`html message ${Buffer.byteLength(html, 'utf8')}B variant=${variant}`);
    return sock.relayMessage(jid, message.message, { messageId: message.key.id });
}

module.exports = { esc, htmlPage, sendHtmlMessage };
