import { pool } from './db.js';
import { DELETE_AFTER_MS } from './config.js';
import { changed } from './live.js';
import { audit, actor } from './audit.js';

const LOCK_ID = 7_314_002;
const INTERVAL_MS = 5 * 60 * 1000;

export async function cleanup() {
  const client = await pool.connect();
  try {
    const { rows: [{ locked }] } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID]);
    if (!locked) return;
    try {
      const closed = await client.query(`
        UPDATE festival SET closed_at = expires_at, last_activity_at = greatest(last_activity_at, expires_at)
        WHERE closed_at IS NULL AND expires_at <= now() RETURNING id, name`);
      const deleted = await client.query(`
        DELETE FROM festival
        WHERE closed_at IS NOT NULL AND greatest(last_activity_at, closed_at) < now() - $1 * interval '1 millisecond'
        RETURNING id, name`, [DELETE_AFTER_MS]);
      for (const row of closed.rows) await audit(row, actor.system, 'festival.expired');
      for (const row of deleted.rows) await audit({ id: null, name: row.name }, actor.system, 'festival.deleted', { festivalId: row.id });
      await client.query("DELETE FROM audit_log WHERE festival_id IS NULL AND at < now() - interval '90 days'");
      for (const { id } of [...closed.rows, ...deleted.rows]) await changed(id);
      if (closed.rowCount || deleted.rowCount) {
        console.log(`Cleanup: ${closed.rowCount} closed, ${deleted.rowCount} deleted`);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    }
  } finally {
    client.release();
  }
}

export function startCleanup() {
  const run = () => cleanup().catch((err) => console.error('Cleanup failed', err));
  run();
  setInterval(run, INTERVAL_MS).unref();
}
