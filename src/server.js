import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  PORT, BUILD_ID, SECURITY_HEADERS, TOKEN_KEY, DEV_ADMIN,
} from './config.js';
import { send, crossSite, HttpError } from './http.js';
import { migrate } from './migrate.js';
import { attachLive } from './live.js';
import { startCleanup } from './cleanup.js';
import { authEnabled } from './auth.js';
import { pushoverEnabled } from './notify.js';
import {
  match, pageAllowed, adminEnabled, isAdmin,
} from './routes.js';

if (!TOKEN_KEY || TOKEN_KEY.length < 32) {
  console.error('TOKEN_KEY must be set (at least 32 characters)');
  process.exit(1);
}

await migrate();

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  webmanifest: 'application/manifest+json; charset=utf-8',
};
const STATIC = [
  'style.css', 'common.js', 'index.js', 'manage.js', 'screen.js', 'counter.js', 'guest.js', 'report.js', 'admin.js',
  'favicon.svg', 'icon-128.png', 'icon-512.png', 'manifest.webmanifest',
];
const staticFiles = Object.fromEntries(await Promise.all(STATIC.map(async (name) => [
  `/${name}`, [await readFile(publicDir + name), TYPES[name.split('.').pop()]],
])));
staticFiles['/qrcode.js'] = [await readFile(createRequire(import.meta.url).resolve('qrcode-generator')), TYPES.js];

const PAGE_FILES = ['index', 'manage', 'screen', 'counter', 'guest', 'report', 'admin', 'notfound'];
const pages = Object.fromEntries(await Promise.all(PAGE_FILES.map(async (name) => [name, await readFile(`${publicDir}${name}.html`)])));

function page(res, name, status = 200) {
  res.setHeader('Cache-Control', 'no-store');
  send(res, status, pages[name], 'text/html; charset=utf-8');
}

const PAGE_ROUTES = [
  [/^\/m\/([^/]+)$/, 'm', 'manage'],
  [/^\/m\/([^/]+)\/screen$/, 'm', 'screen'],
  [/^\/m\/([^/]+)\/report$/, 'm', 'report'],
  [/^\/t\/([^/]+)$/, 't', 'counter'],
  [/^\/p\/([^/]+)$/, 'p', 'guest'],
];

async function handlePage(req, res, pathname) {
  if (pathname === '/') return page(res, 'index');
  if (pathname === '/admin' && adminEnabled) {
    if (isAdmin(req)) return page(res, 'admin');
    res.writeHead(302, { Location: '/admin/login', 'Cache-Control': 'no-store' });
    return res.end();
  }
  for (const [pattern, kind, name] of PAGE_ROUTES) {
    const found = pathname.match(pattern);
    if (found) return (await pageAllowed(kind, found[1])) ? page(res, name) : page(res, 'notfound', 404);
  }
  return page(res, 'notfound', 404);
}

async function route(req, res) {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');
  if (req.method === 'GET' && Object.hasOwn(staticFiles, pathname)) {
    res.setHeader('Cache-Control', 'no-cache');
    return send(res, 200, ...staticFiles[pathname]);
  }

  const found = match(req.method, pathname);
  if (found) {
    if (req.method !== 'GET' && crossSite(req)) return send(res, 403, { error: 'Ungültige Herkunft' });
    return found.handler(req, res, found.params, searchParams);
  }

  if (pathname.startsWith('/api/') || pathname.startsWith('/admin/')) return send(res, 404, { error: 'Nicht gefunden' });
  if (req.method === 'GET') return handlePage(req, res, pathname);
  return send(res, 405, { error: 'Methode nicht erlaubt' });
}

const server = createServer(async (req, res) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  try {
    await route(req, res);
  } catch (err) {
    if (err instanceof HttpError) {
      if (!res.headersSent) {
        res.setHeader('Cache-Control', 'no-store');
        send(res, err.status, { error: err.message });
      }
      return;
    }
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'Interner Fehler' });
  }
});

attachLive(server);
startCleanup();

server.listen(PORT, () => {
  console.log(`Listening on :${PORT} (build ${BUILD_ID}, admin ${authEnabled ? 'oidc' : DEV_ADMIN ? 'dev' : 'off'}, pushover ${pushoverEnabled ? 'on' : 'off'})`);
});

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});
