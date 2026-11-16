import { query, one } from './db.js';
import { fail } from './http.js';
import { MAX_QTY, UNDO_WINDOW_MS } from './config.js';
import { UUID_RE } from './tokens.js';
import { cleanInt } from './validate.js';

export async function addEntry(festival, device, body) {
  if (!UUID_RE.test(String(body.teamId)) || !UUID_RE.test(String(body.drinkTypeId))) fail(400, 'Team oder Getränk fehlt');
  const qty = cleanInt(body.qty ?? 1, 1, MAX_QTY, 'Menge');
  const row = await one(`
    INSERT INTO entry (festival_id, team_id, drink_type_id, device_id, qty, points)
    SELECT $1, t.id, d.id, $4, $5, d.points * $5
    FROM team t, drink_type d
    WHERE t.id = $2 AND t.festival_id = $1 AND NOT t.hidden
      AND d.id = $3 AND d.festival_id = $1 AND NOT d.hidden
    RETURNING id, qty, points, created_at`, [festival.id, body.teamId, body.drinkTypeId, device.id, qty]);
  if (!row) fail(404, 'Team oder Getränk nicht gefunden');
  await query('UPDATE festival SET last_activity_at = now() WHERE id = $1', [festival.id]);
  return row;
}

export async function undoEntry(festival, id, { device, by }) {
  if (!/^\d{1,15}$/.test(String(id))) fail(404, 'Buchung nicht gefunden');
  const row = device
    ? await one(`
        UPDATE entry SET undone_at = now(), undone_by = $3
        WHERE id = $1 AND festival_id = $2 AND undone_at IS NULL AND device_id = $4
          AND created_at > now() - $5 * interval '1 millisecond'
        RETURNING id`, [id, festival.id, by, device.id, UNDO_WINDOW_MS])
    : await one(`
        UPDATE entry SET undone_at = now(), undone_by = $3
        WHERE id = $1 AND festival_id = $2 AND undone_at IS NULL RETURNING id`, [id, festival.id, by]);
  if (!row) fail(404, device ? 'Buchung nicht gefunden oder zu alt zum Rückgängigmachen' : 'Buchung nicht gefunden oder schon storniert');
  await query('UPDATE festival SET last_activity_at = now() WHERE id = $1', [festival.id]);
  return row;
}

export async function listEntries(festival, filters = {}, limit = 1000) {
  const where = ['e.festival_id = $1'];
  const params = [festival.id];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (UUID_RE.test(String(filters.device))) add('e.device_id = ?', filters.device);
  if (UUID_RE.test(String(filters.team))) add('e.team_id = ?', filters.team);
  if (UUID_RE.test(String(filters.drink))) add('e.drink_type_id = ?', filters.drink);
  if (filters.from && !Number.isNaN(Date.parse(filters.from))) add('e.created_at >= ?', new Date(filters.from));
  if (filters.to && !Number.isNaN(Date.parse(filters.to))) add('e.created_at <= ?', new Date(filters.to));
  params.push(limit);
  const { rows } = await query(`
    SELECT e.id::text AS id, e.qty, e.points, e.created_at, e.undone_at, e.undone_by,
      t.id AS team_id, t.name AS team, t.color AS team_color,
      d.id AS drink_id, d.name AS drink, d.emoji AS drink_emoji,
      v.id AS device_id, v.name AS device
    FROM entry e
    JOIN team t ON t.id = e.team_id
    JOIN drink_type d ON d.id = e.drink_type_id
    LEFT JOIN device v ON v.id = e.device_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT $${params.length}`, params);
  return rows;
}

export async function recentForDevice(festival, device) {
  const { rows } = await query(`
    SELECT e.id::text AS id, e.qty, e.points, e.created_at, e.undone_at,
      t.name AS team, t.color AS team_color, d.name AS drink, d.emoji AS drink_emoji,
      e.created_at > now() - $3 * interval '1 millisecond' AS undoable
    FROM entry e JOIN team t ON t.id = e.team_id JOIN drink_type d ON d.id = e.drink_type_id
    WHERE e.festival_id = $1 AND e.device_id = $2
    ORDER BY e.created_at DESC, e.id DESC LIMIT 15`, [festival.id, device.id, UNDO_WINDOW_MS]);
  return rows;
}

export async function listDrinks(festival) {
  const { rows } = await query(`
    SELECT d.id, d.name, d.emoji, d.points, d.sort, d.hidden,
      coalesce(sum(e.qty) FILTER (WHERE e.undone_at IS NULL), 0)::int AS drinks
    FROM drink_type d LEFT JOIN entry e ON e.drink_type_id = d.id
    WHERE d.festival_id = $1 GROUP BY d.id ORDER BY d.sort, d.name`, [festival.id]);
  return rows;
}
