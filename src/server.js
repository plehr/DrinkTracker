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
import { match, adminEnabled, isAdmin } from './routes.js';
import { byManageToken, byCounterToken, byPublicId } from './festivals.js';
import { teamById } from './teams.js';
import { publicState } from './stats.js';
import { page } from './pages.js';

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
  'favicon.svg', 'icon-128.png', 'icon-512.png', 'og.png', 'manifest.webmanifest',
];
const staticFiles = Object.fromEntries(await Promise.all(STATIC.map(async (name) => [
  `/${name}`, [await readFile(publicDir + name), TYPES[name.split('.').pop()]],
])));
staticFiles['/qrcode.js'] = [await readFile(createRequire(import.meta.url).resolve('qrcode-generator')), TYPES.js];

const PAGE_ROUTES = [
  [/^\/m\/([^/]+)$/, byManageToken, 'manage', (f) => ({ title: `Verwaltung ${f.name}`, description: `Geheimer Verwaltungs-Link für „${f.name}“. Nicht weitergeben.` })],
  [/^\/m\/([^/]+)\/screen$/, byManageToken, 'screen', (f) => ({ title: f.name, description: `Live-Ranking von „${f.name}“ für den großen Bildschirm.` })],
  [/^\/m\/([^/]+)\/report$/, byManageToken, 'report', (f) => ({ title: `Bericht ${f.name}`, description: `Bericht und Buchungsprotokoll von „${f.name}“.` })],
  [/^\/t\/([^/]+)$/, byCounterToken, 'counter', (f) => ({ title: `Kasse ${f.name}`, description: `Kassen-Zugang für „${f.name}“: Getränke für Teams buchen. Nur für das Kassenpersonal.` })],
  [/^\/p\/([^/]+)$/, byPublicId, 'guest', (f) => ({
    title: f.name,
    description: `${f.theme?.subtitle ? `${f.theme.subtitle} – ` : ''}Wähl dein Team und verfolge live, auf welchem Platz ihr steht. 🍻`,
  })],
];

async function handlePage(req, res, pathname) {
  if (pathname === '/') return page(res, 'index');
  if (pathname === '/admin' && adminEnabled) {
    if (isAdmin(req)) return page(res, 'admin', { title: 'Admin' });
    res.writeHead(302, { Location: '/admin/login', 'Cache-Control': 'no-store' });
    return res.end();
  }
  const teamLink = pathname.match(/^\/p\/([^/]+)\/team\/([^/]+)$/);
  if (teamLink) {
    const festival = await byPublicId(teamLink[1]);
    const team = festival && await teamById(festival, teamLink[2]);
    if (!team || team.hidden) return page(res, 'notfound', { title: 'Nicht gefunden' }, 404);
    const { teams } = await publicState(festival);
    const ranked = teams.find((row) => row.id === team.id);
    const place = ranked ? ` – aktuell Platz ${ranked.rank} von ${teams.length}` : '';
    return page(res, 'guest', {
      title: `${team.name} @ ${festival.name}`,
      description: `Mach mit bei Team „${team.name}“${place}. Verfolge live, wie euer Team im Ranking steht. 🍻`,
      path: pathname,
    });
  }
  for (const [pattern, lookup, name, meta] of PAGE_ROUTES) {
    const found = pathname.match(pattern);
    if (!found) continue;
    const festival = await lookup(found[1]);
    return festival ? page(res, name, { ...meta(festival), path: pathname.startsWith('/p/') ? pathname : '/' }) : page(res, 'notfound', { title: 'Nicht gefunden' }, 404);
  }
  return page(res, 'notfound', { title: 'Nicht gefunden' }, 404);
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
