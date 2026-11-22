'use strict';

const config = require('./config');

class ApiError extends Error {
    constructor(code, message, status) {
        super(message || code);
        this.code = code || 'api_error';
        this.status = status || 0;
    }
}

async function request(pathname, options = {}) {
    const base = config.apiBaseUrl;
    if (!base) throw new ApiError('api_unconfigured', 'licence server is not configured');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || config.apiTimeoutMs);
    if (timer.unref) timer.unref();

    try {
        const response = await fetch(`${base}${pathname}`, {
            method: options.method || 'GET',
            headers: { 'content-type': 'application/json', ...(options.headers || {}) },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: controller.signal,
        });

        const text = await response.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = { raw: text };
            }
        }

        if (!response.ok) {
            throw new ApiError(
                (data && data.code) || `http_${response.status}`,
                (data && (data.error || data.message)) || `HTTP ${response.status}`,
                response.status
            );
        }
        return data || {};
    } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error.name === 'AbortError') throw new ApiError('api_timeout', 'licence server timed out');
        throw new ApiError('api_unreachable', error.message || 'licence server unreachable');
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    ApiError,
    request,
    post: (pathname, body, options = {}) => request(pathname, { ...options, method: 'POST', body }),
    get: (pathname, options = {}) => request(pathname, { ...options, method: 'GET' }),
};
