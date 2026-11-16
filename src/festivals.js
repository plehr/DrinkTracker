import { query, one, tx } from './db.js';
import { fail } from './http.js';
import { FESTIVAL_TTL_MS, PUBLIC_URL } from './config.js';
import {
  TOKEN_RE, PUBLIC_ID_RE, UUID_RE, newPublicId, sealedToken, tokenIndex, decryptToken,
} from './tokens.js';
import {
  cleanText, cleanEmoji, cleanColor, parseImage,
} from './validate.js';

export const PRESETS = ['blaulicht', 'nacht', 'hell', 'feuer'];

const DEFAULT_THEME = {
  preset: 'blaulicht',
  primary: '#2f6bff',
  accent: '#ff3b3b',
  subtitle: '',
  barIcon: '🚒',
  showPublicQr: true,
  guestTeams: true,
};

const DEFAULT_DRINKS = [
  ['Bier', '🍺', 1],
  ['Kurzer', '🥃', 1],
  ['Longdrink', '🍹', 2],
  ['Alkoholfrei', '🥤', 1],
];

export const theme = (festival) => ({ ...DEFAULT_THEME, ...festival.theme });

export const isOpen = (festival) => !festival.closed_at && new Date(festival.expires_at).getTime() > Date.now();

export function assertOpen(festival) {
  if (!isOpen(festival)) fail(409, 'Das Fest ist beendet');
}

export function iconUrl(festival) {
  return festival.icon_mime ? `/i/${festival.public_id}?v=${festival.icon_version}` : null;
}

export function links(festival) {
  const manage = decryptToken(festival.manage_token_enc);
  const counter = decryptToken(festival.counter_token_enc);
  return {
    manageUrl: `${PUBLIC_URL}/m/${manage}`,
    screenUrl: `${PUBLIC_URL}/m/${manage}/screen`,
    reportUrl: `${PUBLIC_URL}/m/${manage}/report`,
    counterUrl: `${PUBLIC_URL}/t/${counter}`,
    publicUrl: `${PUBLIC_URL}/p/${festival.public_id}`,
  };
}

function cleanIcon(body) {
  const emoji = cleanEmoji(body.iconEmoji);
  const image = body.iconImage ? parseImage(body.iconImage) : null;
  return { emoji, image };
}

export async function createFestival(body, ip) {
  const name = cleanText(body.name, 80, 'Name');
  const { emoji, image } = cleanIcon(body);
  const manage = sealedToken();
  const counter = sealedToken();
  const festival = await tx(async (client) => {
    const { rows: [row] } = await client.query(`
      INSERT INTO festival (name, public_id, manage_token_enc, manage_idx, counter_token_enc, counter_idx,
                            icon_emoji, icon_image, icon_mime, icon_version, theme, expires_at, creator_ip)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now() + $12 * interval '1 millisecond', $13)
      RETURNING *`, [
      name, newPublicId(), manage.enc, manage.idx, counter.enc, counter.idx,
      emoji || null, image?.buffer ?? null, image?.mime ?? null, image ? 1 : 0, DEFAULT_THEME, FESTIVAL_TTL_MS, ip,
    ]);
    for (const [index, [drink, symbol, points]] of DEFAULT_DRINKS.entries()) {
      await client.query(
        'INSERT INTO drink_type (festival_id, name, emoji, points, sort) VALUES ($1, $2, $3, $4, $5)',
        [row.id, drink, symbol, points, index],
      );
    }
    return row;
  });
  return { festival, manageToken: manage.token };
}

export const byId = (id) => (UUID_RE.test(id) ? one('SELECT * FROM festival WHERE id = $1', [id]) : null);
export const byPublicId = (id) => (PUBLIC_ID_RE.test(id) ? one('SELECT * FROM festival WHERE public_id = $1', [id]) : null);
export const byManageToken = (token) => (TOKEN_RE.test(token) ? one('SELECT * FROM festival WHERE manage_idx = $1', [tokenIndex(token)]) : null);
export const byCounterToken = (token) => (TOKEN_RE.test(token) ? one('SELECT * FROM festival WHERE counter_idx = $1', [tokenIndex(token)]) : null);

export async function touch(id) {
  await query('UPDATE festival SET last_activity_at = now() WHERE id = $1', [id]);
}

export async function updateFestival(festival, body) {
  const name = body.name === undefined ? festival.name : cleanText(body.name, 80, 'Name');
  const current = theme(festival);
  const raw = body.theme ?? {};
  const next = {
    preset: PRESETS.includes(raw.preset) ? raw.preset : current.preset,
    primary: cleanColor(raw.primary, current.primary),
    accent: cleanColor(raw.accent, current.accent),
    subtitle: raw.subtitle === undefined ? current.subtitle : cleanText(raw.subtitle, 120, 'Untertitel', { optional: true }),
    barIcon: raw.barIcon === undefined ? current.barIcon : cleanEmoji(raw.barIcon),
    showPublicQr: typeof raw.showPublicQr === 'boolean' ? raw.showPublicQr : current.showPublicQr,
    guestTeams: typeof raw.guestTeams === 'boolean' ? raw.guestTeams : current.guestTeams,
  };
  return one(
    'UPDATE festival SET name = $2, theme = $3, last_activity_at = now() WHERE id = $1 RETURNING *',
    [festival.id, name, next],
  );
}

export async function setIcon(festival, body) {
  const { emoji, image } = cleanIcon(body);
  if (image) {
    return one(`UPDATE festival SET icon_emoji = $2, icon_image = $3, icon_mime = $4, icon_version = icon_version + 1,
                  last_activity_at = now() WHERE id = $1 RETURNING *`, [festival.id, emoji || null, image.buffer, image.mime]);
  }
  const keepImage = body.keepImage === true;
  return one(`UPDATE festival SET icon_emoji = $2,
                icon_image = CASE WHEN $3 THEN icon_image END, icon_mime = CASE WHEN $3 THEN icon_mime END,
                icon_version = icon_version + 1, last_activity_at = now()
              WHERE id = $1 RETURNING *`, [festival.id, emoji || null, keepImage]);
}

export async function closeFestival(id) {
  return one(
    'UPDATE festival SET closed_at = now(), last_activity_at = now() WHERE id = $1 AND closed_at IS NULL RETURNING *',
    [id],
  );
}

export async function deleteFestival(id) {
  const { rowCount } = await query('DELETE FROM festival WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function rotateCounterToken(festival) {
  const counter = sealedToken();
  await query(
    'UPDATE festival SET counter_token_enc = $2, counter_idx = $3, last_activity_at = now() WHERE id = $1',
    [festival.id, counter.enc, counter.idx],
  );
  return `${PUBLIC_URL}/t/${counter.token}`;
}

export async function listFestivals() {
  const { rows } = await query(`
    SELECT f.*,
      (SELECT count(*) FROM team t WHERE t.festival_id = f.id)::int AS team_count,
      (SELECT count(*) FROM device d WHERE d.festival_id = f.id)::int AS device_count,
      (SELECT coalesce(sum(e.qty), 0) FROM entry e WHERE e.festival_id = f.id AND e.undone_at IS NULL)::int AS drink_count
    FROM festival f ORDER BY f.created_at DESC`);
  return rows;
}

export async function getSetting(key, fallback) {
  const row = await one('SELECT value FROM setting WHERE key = $1', [key]);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await query(
    'INSERT INTO setting (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, JSON.stringify(value)],
  );
}
