import { query } from './db.js';
import { theme, iconUrl, isOpen } from './festivals.js';

// Standard competition ranking: equal points share a place (1, 2, 2, 4).
export function rank(teams) {
  const sorted = [...teams].sort((a, b) => b.points - a.points || b.drinks - a.drinks || a.name.localeCompare(b.name, 'de'));
  let place = 0;
  return sorted.map((team, index) => {
    if (index === 0 || team.points !== sorted[index - 1].points) place = index + 1;
    return { ...team, rank: place };
  });
}

export function festivalInfo(festival) {
  return {
    name: festival.name,
    publicId: festival.public_id,
    iconEmoji: festival.icon_emoji,
    iconUrl: iconUrl(festival),
    theme: theme(festival),
    open: isOpen(festival),
    createdAt: festival.created_at,
    expiresAt: festival.expires_at,
    closedAt: festival.closed_at,
  };
}

// Shared with guests, counters and the screen: ranking only, no statistics.
export async function publicState(festival) {
  const [teams, drinks] = await Promise.all([
    query(`
      SELECT t.id, t.name, t.color,
        coalesce(sum(e.qty), 0)::int AS drinks, coalesce(sum(e.points), 0)::int AS points
      FROM team t LEFT JOIN entry e ON e.team_id = t.id AND e.undone_at IS NULL
      WHERE t.festival_id = $1 AND NOT t.hidden GROUP BY t.id`, [festival.id]),
    query(`
      SELECT id, name, emoji, points FROM drink_type
      WHERE festival_id = $1 AND NOT hidden ORDER BY sort, name`, [festival.id]),
  ]);
  return {
    festival: festivalInfo(festival),
    teams: rank(teams.rows),
    drinks: drinks.rows,
    at: new Date().toISOString(),
  };
}

// Only for the festival owner (management page and report).
export async function ownerStats(festival) {
  const [totals, drinks, hourly, lastHour, recent] = await Promise.all([
    query(`
      SELECT coalesce(sum(e.qty), 0)::int AS drinks, coalesce(sum(e.points), 0)::int AS points,
        (SELECT count(*) FROM team WHERE festival_id = $1 AND NOT hidden)::int AS teams
      FROM entry e JOIN team t ON t.id = e.team_id
      WHERE e.festival_id = $1 AND e.undone_at IS NULL AND NOT t.hidden`, [festival.id]),
    query(`
      SELECT d.id, d.name, d.emoji, coalesce(sum(e.qty), 0)::int AS count
      FROM drink_type d LEFT JOIN entry e ON e.drink_type_id = d.id AND e.undone_at IS NULL
      WHERE d.festival_id = $1 GROUP BY d.id`, [festival.id]),
    query(`
      SELECT date_trunc('hour', created_at) AS hour, sum(qty)::int AS count
      FROM entry WHERE festival_id = $1 AND undone_at IS NULL AND created_at > now() - interval '12 hours'
      GROUP BY 1 ORDER BY 1`, [festival.id]),
    query(`
      SELECT coalesce(sum(qty), 0)::int AS count FROM entry
      WHERE festival_id = $1 AND undone_at IS NULL AND created_at > now() - interval '1 hour'`, [festival.id]),
    query(`
      SELECT e.id::text AS id, e.qty, e.created_at, t.name AS team, t.color AS team_color, d.name AS drink, d.emoji AS drink_emoji
      FROM entry e JOIN team t ON t.id = e.team_id JOIN drink_type d ON d.id = e.drink_type_id
      WHERE e.festival_id = $1 AND e.undone_at IS NULL AND NOT t.hidden
      ORDER BY e.created_at DESC, e.id DESC LIMIT 8`, [festival.id]),
  ]);
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const counts = new Map(hourly.rows.map((row) => [new Date(row.hour).getTime(), row.count]));
  return {
    totalDrinks: totals.rows[0].drinks,
    totalPoints: totals.rows[0].points,
    teamCount: totals.rows[0].teams,
    lastHour: lastHour.rows[0].count,
    perHour: Array.from({ length: 12 }, (_, i) => {
      const hour = now.getTime() - (11 - i) * 3600_000;
      return { hour: new Date(hour).toISOString(), count: counts.get(hour) ?? 0 };
    }),
    recent: recent.rows,
    topDrink: drinks.rows.reduce((best, drink) => (drink.count > (best?.count ?? 0) ? drink : best), null),
  };
}
