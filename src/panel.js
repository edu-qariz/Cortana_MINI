'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const config = require('./config');
const logger = require('./logger');
const bot = require('./bot');

let server = null;

function authorized(req) {
    if (!config.panelToken) return true;
    const supplied = req.get('x-panel-token') || req.query.token;
    return supplied === config.panelToken;
}

function start() {
    if (server) return server;
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '64kb' }));

    const html = fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8');

    app.get('/', (req, res) => {
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    });

    app.get('/health', (req, res) => {
        res.json({ ok: true, connected: bot.isConnected(), version: config.versionLabel });
    });

    app.use('/api', (req, res, next) => {
        if (!authorized(req)) return res.status(401).json({ error: 'invalid panel token' });
        next();
    });

    app.get('/api/status', (req, res) => {
        res.json(bot.getStatus());
    });

    app.get('/api/menu', (req, res) => {
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(bot.menuPreview());
    });

    app.post('/api/pair', async (req, res) => {
        try {
            const result = await bot.requestPairing(req.body?.phone, req.body?.code);
            res.json(result);
        } catch (error) {
            const expected = /invalid phone|already paired|did not become ready/i.test(error.message);
            if (expected) logger.warn(`panel.pair rejected: ${error.message}`);
            else logger.error('panel.pair', error);
            res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/restart', (req, res) => {
        res.json({ ok: true });
        setTimeout(() => bot.restart().catch((error) => logger.error('panel.restart', error)), 250);
    });

    app.post('/api/logout', (req, res) => {
        res.json({ ok: true });
        setTimeout(() => bot.logout().catch((error) => logger.error('panel.logout', error)), 250);
    });

    app.get('/api/events', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        const unsubscribe = logger.subscribe((event) => {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        });
        const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
        if (ping.unref) ping.unref();
        req.on('close', () => {
            clearInterval(ping);
            unsubscribe();
        });
    });

    return new Promise((resolve, reject) => {
        const instance = http.createServer(app);
        const onError = (error) => {
            server = null;
            instance.close(() => {});
            reject(error);
        };
        instance.once('error', onError);
        instance.listen(config.port, '0.0.0.0', () => {
            instance.off('error', onError);
            server = instance;
            const address = instance.address();
            const port = typeof address === 'object' && address ? address.port : config.port;
            logger.success(`panel listening on http://localhost:${port}`);
            if (config.panelToken) logger.info('panel token protection is ON');
            resolve(instance);
        });
    });
}

function stop() {
    if (!server) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
}

module.exports = { start, stop };
