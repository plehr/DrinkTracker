import { MAX_BODY, PUBLIC_ORIGIN, SECURE_COOKIES } from './config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const fail = (status, message) => { throw new HttpError(status, message); };

export function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

export function sendNoStore(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  send(res, status, body);
}

export async function readJson(req, max = MAX_BODY) {
  if (Number(req.headers['content-length']) > max) fail(413, 'Anfrage zu groß');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) fail(413, 'Anfrage zu groß');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    const body = JSON.parse(text);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) fail(400, 'Ungültige Anfrage');
    return body;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return fail(400, 'Ungültige Anfrage');
  }
}

export function clientIp(req) {
  return req.headers['x-real-ip']
    ?? req.headers['x-forwarded-for']?.split(',')[0].trim()
    ?? req.socket.remoteAddress;
}

export function crossSite(req) {
  const { origin } = req.headers;
  if (!origin) return req.headers['sec-fetch-site'] === 'cross-site';
  return origin !== PUBLIC_ORIGIN;
}

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

export function setCookie(res, name, value, maxAgeMs, path = '/') {
  const line = `${name}=${value}; Path=${path}; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}; HttpOnly; SameSite=Lax${SECURE_COOKIES ? '; Secure' : ''}`;
  const existing = res.getHeader('Set-Cookie') ?? [];
  res.setHeader('Set-Cookie', [...[existing].flat(), line]);
}

const buckets = new Map();

export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.since > windowMs) {
    buckets.set(key, { since: now, count: 1, windowMs });
    return;
  }
  if (++bucket.count > max) fail(429, 'Zu viele Anfragen, bitte kurz warten');
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (now - bucket.since > bucket.windowMs) buckets.delete(key);
}, 10 * 60 * 1000).unref();
