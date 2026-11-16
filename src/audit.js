import { query } from './db.js';
import { clientIp } from './http.js';
import { UUID_RE } from './tokens.js';

export const counterLabel = (device) => {
  if (!device) return 'Kasse';
  return /^kasse\b/i.test(device.name) ? device.name : `Kasse ${device.name}`;
};

export const actor = {
  owner: (req) => ({ type: 'owner', label: 'Veranstalter', ip: clientIp(req) }),
  counter: (req, device) => ({ type: 'counter', label: counterLabel(device), ip: clientIp(req) }),
  guest: (req) => ({ type: 'guest', label: 'Gast', ip: clientIp(req) }),
  admin: (req, name) => ({ type: 'admin', label: `Admin ${name ?? ''}`.trim(), ip: clientIp(req) }),
  system: { type: 'system', label: 'System', ip: null },
};

// Never fails the request: a lost audit row is logged, the action itself already happened.
export async function audit(festival, who, action, details = {}) {
  try {
    await query(
      `INSERT INTO audit_log (festival_id, festival_name, actor_type, actor_label, ip, action, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [festival?.id ?? null, festival?.name ?? null, who.type, who.label, who.ip, action, details],
    );
  } catch (err) {
    console.error('Audit log failed', action, err.message);
  }
}

export async function listAudit({ festivalId, limit = 500, withIp = false } = {}) {
  const params = [];
  let where = '';
  if (festivalId) {
    if (!UUID_RE.test(String(festivalId))) return [];
    params.push(festivalId);
    where = 'WHERE a.festival_id = $1';
  }
  params.push(Math.min(Math.max(Number(limit) || 500, 1), 2000));
  const { rows } = await query(`
    SELECT a.id::text AS id, a.at, a.festival_id, coalesce(f.name, a.festival_name) AS festival,
      a.actor_type, a.actor_label, ${withIp ? 'a.ip,' : ''} a.action, a.details
    FROM audit_log a LEFT JOIN festival f ON f.id = a.festival_id
    ${where}
    ORDER BY a.at DESC, a.id DESC
    LIMIT $${params.length}`, params);
  return rows;
}
