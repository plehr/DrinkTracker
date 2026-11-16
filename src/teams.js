import { query, one, tx } from './db.js';
import { fail } from './http.js';
import { MAX_TEAMS, PUBLIC_URL } from './config.js';
import {
  TOKEN_RE, UUID_RE, sealedToken, tokenIndex, decryptToken,
} from './tokens.js';
import { cleanText, cleanColor } from './validate.js';

export const TEAM_COLORS = [
  '#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1',
  '#fdd835', '#d81b60', '#6d4c41', '#3949ab', '#7cb342', '#f4511e',
];

const uniqueName = (err) => {
  if (err.code === '23505') fail(409, 'Diesen Teamnamen gibt es schon');
  throw err;
};

export async function teamById(festival, id) {
  if (!UUID_RE.test(String(id))) return null;
  return one('SELECT * FROM team WHERE id = $1 AND festival_id = $2', [id, festival.id]);
}

export async function teamsByOwnerTokens(festival, tokens) {
  const valid = tokens.filter((token) => TOKEN_RE.test(token));
  if (!valid.length) return [];
  const { rows } = await query(
    'SELECT * FROM team WHERE festival_id = $1 AND owner_idx = ANY($2)',
    [festival.id, valid.map(tokenIndex)],
  );
  return rows;
}

export const ownerLink = (festival, team) => `${PUBLIC_URL}/p/${festival.public_id}/o/${decryptToken(team.owner_token_enc)}`;

export async function createTeam(festival, body, createdBy) {
  const name = cleanText(body.name, 40, 'Teamname');
  const owner = sealedToken();
  const team = await tx(async (client) => {
    await client.query('SELECT 1 FROM festival WHERE id = $1 FOR UPDATE', [festival.id]);
    const { rows: [{ count }] } = await client.query('SELECT count(*)::int AS count FROM team WHERE festival_id = $1', [festival.id]);
    if (count >= MAX_TEAMS) fail(409, `Maximal ${MAX_TEAMS} Teams pro Fest`);
    const color = cleanColor(body.color, TEAM_COLORS[count % TEAM_COLORS.length]);
    const { rows: [row] } = await client.query(`
      INSERT INTO team (festival_id, name, color, sort, created_by, owner_token_enc, owner_idx)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [festival.id, name, color, count, createdBy, owner.enc, owner.idx]).catch(uniqueName);
    await client.query('UPDATE festival SET last_activity_at = now() WHERE id = $1', [festival.id]);
    return row;
  });
  return { team, ownerToken: owner.token };
}

export async function updateTeam(festival, team, body) {
  const name = body.name === undefined ? team.name : cleanText(body.name, 40, 'Teamname');
  const color = cleanColor(body.color, team.color);
  const hidden = typeof body.hidden === 'boolean' ? body.hidden : team.hidden;
  const row = await one(
    'UPDATE team SET name = $3, color = $4, hidden = $5 WHERE id = $1 AND festival_id = $2 RETURNING *',
    [team.id, festival.id, name, color, hidden],
  ).catch(uniqueName);
  await query('UPDATE festival SET last_activity_at = now() WHERE id = $1', [festival.id]);
  return row;
}

export async function deleteTeam(festival, team) {
  const used = await one('SELECT 1 FROM entry WHERE team_id = $1 LIMIT 1', [team.id]);
  if (used) fail(409, 'Das Team hat Buchungen. Ausblenden oder zusammenführen statt löschen.');
  await query('DELETE FROM team WHERE id = $1 AND festival_id = $2', [team.id, festival.id]);
}

export async function mergeTeam(festival, team, into) {
  if (team.id === into.id) fail(400, 'Ein Team kann nicht mit sich selbst zusammengeführt werden');
  await tx(async (client) => {
    await client.query('UPDATE entry SET team_id = $2 WHERE team_id = $1 AND festival_id = $3', [team.id, into.id, festival.id]);
    await client.query('DELETE FROM team WHERE id = $1 AND festival_id = $2', [team.id, festival.id]);
    await client.query('UPDATE festival SET last_activity_at = now() WHERE id = $1', [festival.id]);
  });
}

export async function rotateOwnerToken(festival, team) {
  const owner = sealedToken();
  const row = await one(
    'UPDATE team SET owner_token_enc = $3, owner_idx = $4 WHERE id = $1 AND festival_id = $2 RETURNING *',
    [team.id, festival.id, owner.enc, owner.idx],
  );
  return ownerLink(festival, row);
}

export async function listTeams(festival) {
  const { rows } = await query(`
    SELECT t.id, t.name, t.color, t.hidden, t.created_by, t.created_at,
      coalesce(sum(e.qty) FILTER (WHERE e.undone_at IS NULL), 0)::int AS drinks,
      coalesce(sum(e.points) FILTER (WHERE e.undone_at IS NULL), 0)::int AS points,
      count(e.id)::int AS entries
    FROM team t LEFT JOIN entry e ON e.team_id = t.id
    WHERE t.festival_id = $1
    GROUP BY t.id ORDER BY t.sort, t.created_at`, [festival.id]);
  return rows;
}
