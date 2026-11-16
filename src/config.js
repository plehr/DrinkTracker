export const PORT = Number(process.env.PORT) || 3000;
export const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/$/, '') || `http://localhost:${PORT}`;
export const PUBLIC_ORIGIN = new URL(PUBLIC_URL).origin;
export const SECURE_COOKIES = PUBLIC_URL.startsWith('https:');
export const BUILD_ID = process.env.BUILD_ID || 'dev';
export const TOKEN_KEY = process.env.TOKEN_KEY;
export const PUSHOVER_TOKEN = process.env.PUSHOVER_TOKEN;
export const PUSHOVER_USER = process.env.PUSHOVER_USER;
// Local development only: admin pages without OIDC.
export const DEV_ADMIN = process.env.NODE_ENV !== 'production' && process.env.DEV_ADMIN === '1';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const FESTIVAL_TTL_MS = 3 * DAY_MS;
export const DELETE_AFTER_MS = 7 * DAY_MS;
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export const MAX_BODY = 16 * 1024;
export const MAX_ICON_BODY = 1024 * 1024;
export const MAX_ICON_BYTES = 512 * 1024;
export const MAX_TEAMS = 200;
export const MAX_DRINKS = 30;
export const MAX_DEVICES = 50;
export const MAX_QTY = 50;
export const MAX_OWNED_TEAMS = 20;

const wsOrigin = PUBLIC_ORIGIN.replace(/^http/, 'ws');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
  + `connect-src 'self' ${wsOrigin}; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;

export const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};
