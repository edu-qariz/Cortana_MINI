const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
    const normalised = String(value).replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalised.length % 4)) % 4);
    const binary = atob(normalised + padding);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret) {
    return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// Detached HMAC-SHA256 over the base64url JSON body: "<body>.<signature>".
export async function signToken(secret, payload) {
    if (!secret) throw new Error('LICENCE_SECRET is not set');
    const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body)));
    return `${body}.${toBase64Url(signature)}`;
}

export async function verifyToken(secret, token, now = Date.now()) {
    if (!secret || typeof token !== 'string' || !token.includes('.')) return null;
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;
    try {
        const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64Url(signature), encoder.encode(body));
        if (!valid) return null;
        const payload = JSON.parse(decoder.decode(fromBase64Url(body)));
        if (typeof payload?.exp !== 'number' || payload.exp * 1000 <= now) return null;
        return payload;
    } catch {
        return null;
    }
}

export function bearerToken(request) {
    const header = request.headers.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : '';
}
