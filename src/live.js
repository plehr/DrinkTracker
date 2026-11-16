import pg from 'pg';
import { WebSocketServer } from 'ws';
import { query } from './db.js';
import { PUBLIC_ORIGIN } from './config.js';
import { byId, byPublicId } from './festivals.js';
import { publicState } from './stats.js';

const CHANNEL = 'festival_events';
const PING_MS = 15_000;
const DEBOUNCE_MS = 250;
const MAX_CLIENTS = 5000;

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
      wss.handleUpgrade(req, socket, head, async (ws) => {
        clientCount++;
        ws.alive = true;
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
