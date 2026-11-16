import { query, one } from './db.js';
import { fail } from './http.js';
import { MAX_DEVICES } from './config.js';
import { UUID_RE } from './tokens.js';
import { cleanText } from './validate.js';

export async function deviceById(festival, id) {
  if (!UUID_RE.test(String(id))) return null;
  return one(
    'UPDATE device SET last_seen_at = now() WHERE id = $1 AND festival_id = $2 RETURNING *',
    [id, festival.id],
  );
}

// Registering an existing name takes over that register, so a tablet that lost its cookie keeps its history.
export async function registerDevice(festival, body, current) {
  const name = cleanText(body.name, 30, 'Name der Kasse');
  if (current) {
    return one(
      'UPDATE device SET name = $3, last_seen_at = now() WHERE id = $1 AND festival_id = $2 RETURNING *',
      [current.id, festival.id, name],
    ).catch((err) => {
      if (err.code === '23505') fail(409, 'Diesen Kassennamen gibt es schon');
      throw err;
    });
  }
  const existing = await one('SELECT * FROM device WHERE festival_id = $1 AND lower(name) = lower($2)', [festival.id, name]);
  if (existing) return existing;
  const { rows: [{ count }] } = await query('SELECT count(*)::int AS count FROM device WHERE festival_id = $1', [festival.id]);
  if (count >= MAX_DEVICES) fail(409, `Maximal ${MAX_DEVICES} Kassen pro Fest`);
  return one(`
    INSERT INTO device (festival_id, name) VALUES ($1, $2)
    ON CONFLICT (festival_id, lower(name)) DO UPDATE SET last_seen_at = now()
    RETURNING *`, [festival.id, name]);
}

export async function listDevices(festival) {
  const { rows } = await query(`
    SELECT d.id, d.name, d.created_at, d.last_seen_at,
      coalesce(sum(e.qty) FILTER (WHERE e.undone_at IS NULL), 0)::int AS drinks,
      count(e.id) FILTER (WHERE e.undone_at IS NULL)::int AS bookings
    FROM device d LEFT JOIN entry e ON e.device_id = d.id
    WHERE d.festival_id = $1 GROUP BY d.id ORDER BY d.created_at`, [festival.id]);
  return rows;
}
