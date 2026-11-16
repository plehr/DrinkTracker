import pg from 'pg';
import { WebSocketServer } from 'ws';
import { query } from './db.js';
import { PUBLIC_ORIGIN } from './config.js';
import { byId, byPublicId } from './festivals.js';
import { deviceById } from './devices.js';
import { cookies } from './http.js';
import { publicState } from './stats.js';

const CHANNEL = 'festival_events';
const PING_MS = 15_000;
const DEBOUNCE_MS = 250;
const MAX_CLIENTS = 5000;
const ROLES = new Set(['guest', 'screen', 'manage', 'counter']);

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
const subscribers = new Map();
const pending = new Map();
let clientCount = 0;

// Every change goes through Postgres NOTIFY so all replicas push it to their own sockets.
export async function changed(festivalId) {
  await query('SELECT pg_notify($1, $2)', [CHANNEL, festivalId]);
}

function sendJson(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

async function broadcast(festivalId) {
  const sockets = subscribers.get(festivalId);
  if (!sockets?.size) return;
  const festival = await byId(festivalId);
  if (!festival) {
    for (const ws of sockets) {
      sendJson(ws, { type: 'deleted' });
      ws.close(4404, 'deleted');
    }
    return;
  }
  const message = JSON.stringify({ type: 'state', state: await publicState(festival) });
  for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(message);
}

function schedule(festivalId) {
  if (pending.has(festivalId)) return;
  pending.set(festivalId, setTimeout(() => {
    pending.delete(festivalId);
    broadcast(festivalId).catch((err) => console.error('Broadcast failed', err));
  }, DEBOUNCE_MS));
}

async function listen() {
  const client = new pg.Client();
  const retry = () => {
    client.removeAllListeners();
    client.end().catch(() => {});
    setTimeout(listen, 2000);
  };
  client.on('error', (err) => {
    console.error('LISTEN connection lost', err.message);
    retry();
  });
  client.on('notification', (msg) => schedule(msg.payload));
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    for (const festivalId of subscribers.keys()) schedule(festivalId);
  } catch (err) {
    console.error('LISTEN failed', err.message);
    retry();
  }
}

// Connected clients of this replica per festival. The role is what the page says it is (only shown to
// admins); counters are identified by their device cookie.
export function presence() {
  const out = new Map();
  for (const [festivalId, sockets] of subscribers) {
    const entry = { total: 0, guest: 0, screen: 0, manage: 0, counter: 0, counters: [] };
    const devices = new Map();
    for (const ws of sockets) {
      if (ws.readyState !== ws.OPEN) continue;
      entry.total++;
      entry[ws.role]++;
      if (ws.device) devices.set(ws.device.id, { ...ws.device, connections: (devices.get(ws.device.id)?.connections ?? 0) + 1 });
    }
    entry.counters = [...devices.values()];
    out.set(festivalId, entry);
  }
  return out;
}

export function attachLive(server) {
  listen();

  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const origin = req.headers.origin;
      if (url.pathname !== '/ws' || (origin && origin !== PUBLIC_ORIGIN) || clientCount >= MAX_CLIENTS) {
        socket.destroy();
        return;
      }
      const festival = await byPublicId(url.searchParams.get('p') ?? '');
      if (!festival) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const role = ROLES.has(url.searchParams.get('r')) ? url.searchParams.get('r') : 'guest';
      const device = role === 'counter' ? await deviceById(festival, cookies(req)[`dt_dev_${festival.public_id}`]) : null;
      wss.handleUpgrade(req, socket, head, async (ws) => {
        clientCount++;
        ws.alive = true;
        ws.role = role;
        ws.device = device && { id: device.id, name: device.name };
        if (!subscribers.has(festival.id)) subscribers.set(festival.id, new Set());
        subscribers.get(festival.id).add(ws);
        ws.on('pong', () => { ws.alive = true; });
        ws.on('message', () => { ws.alive = true; });
        ws.on('error', () => {});
        ws.on('close', () => {
          clientCount--;
          const set = subscribers.get(festival.id);
          set?.delete(ws);
          if (set?.size === 0) subscribers.delete(festival.id);
        });
        try {
          sendJson(ws, { type: 'state', state: await publicState(festival) });
        } catch (err) {
          console.error('Initial state failed', err);
        }
      });
    } catch (err) {
      console.error('Upgrade failed', err);
      socket.destroy();
    }
  });

  setInterval(() => {
    for (const sockets of subscribers.values()) {
      for (const ws of sockets) {
        if (!ws.alive) {
          ws.terminate();
          continue;
        }
        ws.alive = false;
        ws.ping();
        sendJson(ws, { type: 'ping' });
      }
    }
  }, PING_MS).unref();
}
