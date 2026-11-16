import { query, one } from './db.js';
import { fail } from './http.js';
import { MAX_DRINKS } from './config.js';
import { UUID_RE } from './tokens.js';
import { cleanText, cleanEmoji, cleanInt } from './validate.js';

export async function drinkById(festival, id) {
  if (!UUID_RE.test(String(id))) return null;
  return one('SELECT * FROM drink_type WHERE id = $1 AND festival_id = $2', [id, festival.id]);
}

export async function createDrink(festival, body) {
  const name = cleanText(body.name, 30, 'Getränkename');
  const emoji = cleanEmoji(body.emoji);
  const points = cleanInt(body.points ?? 1, 0, 100, 'Punkte');
  const { rows: [{ count }] } = await query('SELECT count(*)::int AS count FROM drink_type WHERE festival_id = $1', [festival.id]);
  if (count >= MAX_DRINKS) fail(409, `Maximal ${MAX_DRINKS} Getränkearten pro Fest`);
  return one(
    'INSERT INTO drink_type (festival_id, name, emoji, points, sort) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [festival.id, name, emoji, points, count],
  );
}

// Changing points does not rewrite existing bookings: each entry keeps the points it was booked with.
export async function updateDrink(festival, drink, body) {
  const name = body.name === undefined ? drink.name : cleanText(body.name, 30, 'Getränkename');
  const emoji = body.emoji === undefined ? drink.emoji : cleanEmoji(body.emoji);
  const points = body.points === undefined ? drink.points : cleanInt(body.points, 0, 100, 'Punkte');
  const hidden = typeof body.hidden === 'boolean' ? body.hidden : drink.hidden;
  return one(
    'UPDATE drink_type SET name = $3, emoji = $4, points = $5, hidden = $6 WHERE id = $1 AND festival_id = $2 RETURNING *',
    [drink.id, festival.id, name, emoji, points, hidden],
  );
}

export async function deleteDrink(festival, drink) {
  const used = await one('SELECT 1 FROM entry WHERE drink_type_id = $1 LIMIT 1', [drink.id]);
  if (used) fail(409, 'Für dieses Getränk gibt es Buchungen. Ausblenden statt löschen.');
  await query('DELETE FROM drink_type WHERE id = $1 AND festival_id = $2', [drink.id, festival.id]);
}
