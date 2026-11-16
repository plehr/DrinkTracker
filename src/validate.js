import { fail } from './http.js';
import { MAX_ICON_BYTES } from './config.js';

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029]/g;

export function cleanText(value, max, field, { optional = false } = {}) {
  const text = typeof value === 'string' ? value.normalize('NFC').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!text) {
    if (optional) return '';
    fail(400, `${field} fehlt`);
  }
  if ([...text].length > max) fail(400, `${field} ist zu lang (max. ${max} Zeichen)`);
  return text;
}

export function cleanEmoji(value) {
  if (value == null || value === '') return '';
  const text = cleanText(value, 8, 'Symbol', { optional: true });
  if (/[<>"'&]/.test(text)) fail(400, 'Ungültiges Symbol');
  return text;
}

export function cleanColor(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail(400, 'Ungültige Farbe');
  return value.toLowerCase();
}

export function cleanInt(value, min, max, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${field} muss zwischen ${min} und ${max} liegen`);
  return n;
}

const MAGIC = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

export function parseImage(dataUrl) {
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) fail(400, 'Bild muss PNG, JPEG oder WebP sein');
  const [, mime, data] = match;
  const buffer = Buffer.from(data, 'base64');
  if (buffer.length > MAX_ICON_BYTES) fail(400, 'Bild ist zu groß (max. 512 KB)');
  if (!MAGIC[mime](buffer)) fail(400, 'Bild ist beschädigt oder hat ein falsches Format');
  return { mime, buffer };
}
