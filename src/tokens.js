import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes,
} from 'node:crypto';
import { TOKEN_KEY } from './config.js';

const encKey = createHash('sha256').update(`enc:${TOKEN_KEY}`).digest();
const idxKey = createHash('sha256').update(`idx:${TOKEN_KEY}`).digest();

export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
export const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{10}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const newToken = () => randomBytes(16).toString('base64url');
export const newPublicId = () => randomBytes(8).toString('base64url').slice(0, 10);

export const tokenIndex = (token) => createHmac('sha256', idxKey).update(token).digest('base64url');

export function encryptToken(token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, data, cipher.getAuthTag()].map((part) => part.toString('base64url')).join('.');
}

export function decryptToken(value) {
  const [iv, data, tag] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function sealedToken() {
  const token = newToken();
  return { token, enc: encryptToken(token), idx: tokenIndex(token) };
}
