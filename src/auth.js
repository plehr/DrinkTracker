import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PUBLIC_URL, PUBLIC_ORIGIN, SECURE_COOKIES } from './config.js';
import { cookies } from './http.js';
import { audit, actor } from './audit.js';

const ISSUER = process.env.OIDC_ISSUER?.replace(/\/$/, '');
const CLIENT_ID = process.env.OIDC_CLIENT_ID;
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const REDIRECT_URI = `${PUBLIC_URL}/admin/callback`;
const SESSION_COOKIE = 'dt_session';
const LOGIN_COOKIE = 'dt_login';
const SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_MS = 10 * 60 * 1000;

export const authEnabled = Boolean(ISSUER && CLIENT_ID && CLIENT_SECRET && SESSION_SECRET);

let discovery;

async function discover() {
  discovery ??= fetch(`${ISSUER}/.well-known/openid-configuration`).then((res) => {
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    return res.json();
  }).catch((err) => {
    discovery = undefined;
    throw err;
  });
  return discovery;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (value) => createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}

function verify(token) {
  const [body, mac] = String(token ?? '').split('.');
  if (!body || !mac) return null;
  const expected = Buffer.from(hmac(body));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return payload.exp > Date.now() ? payload : null;
}

function cookie(name, value, maxAgeMs) {
  return `${name}=${value}; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${SECURE_COOKIES ? '; Secure' : ''}`;
}

function redirect(res, location, setCookies = []) {
  res.writeHead(302, { Location: location, 'Set-Cookie': setCookies, 'Cache-Control': 'no-store' });
  res.end();
}

export function getSession(req) {
  return authEnabled ? verify(cookies(req)[SESSION_COOKIE]) : null;
}

export async function login(req, res) {
  const config = await discover();
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL(config.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  redirect(res, url.toString(), [cookie(LOGIN_COOKIE, sign({ state, verifier, exp: Date.now() + LOGIN_MS }), LOGIN_MS)]);
}

export async function callback(req, res) {
  const params = new URL(req.url, PUBLIC_URL).searchParams;
  const pending = verify(cookies(req)[LOGIN_COOKIE]);
  if (!pending || !params.get('code') || params.get('state') !== pending.state) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Login fehlgeschlagen.');
  }

  const config = await discover();
  const tokenRes = await fetch(config.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.get('code'),
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: pending.verifier,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);

  // The ID token comes straight from the token endpoint over TLS, so its signature
  // need not be checked (OIDC Core 3.1.3.7); issuer, audience and expiry still are.
  const { id_token: idToken } = await tokenRes.json();
  const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
  const audience = [claims.aud].flat();
  if (claims.iss !== config.issuer || !audience.includes(CLIENT_ID) || claims.exp * 1000 < Date.now()) {
    throw new Error('Invalid ID token');
  }

  const session = { sub: claims.sub, name: claims.name ?? claims.preferred_username ?? claims.email, exp: Date.now() + SESSION_MS };
  await audit(null, actor.admin(req, session.name), 'admin.login');
  redirect(res, '/admin', [cookie(SESSION_COOKIE, sign(session), SESSION_MS), cookie(LOGIN_COOKIE, '', 0)]);
}

export async function logout(req, res) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (req.method !== 'POST' || req.headers.origin !== PUBLIC_ORIGIN) {
    res.writeHead(403, headers);
    return res.end(JSON.stringify({ error: 'Forbidden' }));
  }
  const config = await discover().catch(() => ({}));
  res.writeHead(200, { ...headers, 'Set-Cookie': [cookie(SESSION_COOKIE, '', 0)] });
  res.end(JSON.stringify({ url: config.end_session_endpoint ?? '/' }));
}
