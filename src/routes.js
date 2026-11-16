import {
  send, sendNoStore, readJson, clientIp, cookies, setCookie, rateLimit, fail,
} from './http.js';
import {
  PUBLIC_URL, DELETE_AFTER_MS, MAX_ICON_BODY, MAX_OWNED_TEAMS, DEV_ADMIN,
} from './config.js';
import {
  createFestival, byId, byPublicId, byManageToken, byCounterToken, touch, links, isOpen, assertOpen, theme,
  updateFestival, setIcon, closeFestival, deleteFestival, rotateCounterToken, listFestivals, getSetting, setSetting,
} from './festivals.js';
import {
  teamById, teamsByOwnerTokens, ownerLink, createTeam, updateTeam, deleteTeam, mergeTeam, rotateOwnerToken, listTeams,
} from './teams.js';
import { deviceById, registerDevice, listDevices } from './devices.js';
import {
  addEntry, undoEntry, listEntries, recentForDevice, listDrinks,
} from './entries.js';
import {
  drinkById, createDrink, updateDrink, deleteDrink,
} from './drinks.js';
import { publicState, ownerStats } from './stats.js';
import { changed } from './live.js';
import { sendPushover } from './notify.js';
import { query } from './db.js';
import {
  authEnabled, getSession, login, callback, logout,
} from './auth.js';
import { TOKEN_RE } from './tokens.js';

const routes = [];
const on = (method, pattern, handler) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });

export function match(method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const found = pathname.match(route.pattern);
    if (found) return { handler: route.handler, params: found.slice(1).map(decodeURIComponent) };
  }
  return null;
}

const ID = '([^/]+)';
const cookieAge = (festival) => new Date(festival.expires_at).getTime() - Date.now() + DELETE_AFTER_MS;
const deviceCookie = (festival) => `dt_dev_${festival.public_id}`;
const teamCookie = (festival) => `dt_team_${festival.public_id}`;
const ownerCookie = (festival) => `dt_own_${festival.public_id}`;

async function need(promise, message = 'Nicht gefunden') {
  const value = await promise;
  if (!value) fail(404, message);
  return value;
}

function ownerTokens(req, festival) {
  return (cookies(req)[ownerCookie(festival)] ?? '').split('.').filter((token) => TOKEN_RE.test(token));
}

function addOwnerToken(req, res, festival, token) {
  const tokens = [...new Set([token, ...ownerTokens(req, festival)])].slice(0, MAX_OWNED_TEAMS);
  setCookie(res, ownerCookie(festival), tokens.join('.'), cookieAge(festival));
}

async function ownedTeams(req, festival) {
  return teamsByOwnerTokens(festival, ownerTokens(req, festival));
}

async function emit(festival) {
  await changed(festival.id);
}

// ---------- start page ----------

on('GET', '/api/config', async (req, res) => {
  sendNoStore(res, 200, { creationEnabled: await getSetting('creation_enabled', true) });
});

on('POST', '/api/festivals', async (req, res) => {
  if (!(await getSetting('creation_enabled', true))) fail(403, 'Neue Feste können derzeit nicht angelegt werden');
  const ip = clientIp(req);
  const body = await readJson(req, MAX_ICON_BODY);
  rateLimit(`festival:${ip}`, 5, 60 * 60 * 1000);
  const { festival, manageToken } = await createFestival(body, ip);
  sendPushover('Neues Fest gestartet', `${festival.name}\n${new Date(festival.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`);
  sendNoStore(res, 201, { manageUrl: `${PUBLIC_URL}/m/${manageToken}`, name: festival.name });
});

on('GET', `/i/${ID}`, async (req, res, [publicId]) => {
  const festival = await byPublicId(publicId);
  if (!festival?.icon_mime) return send(res, 404, 'Not found', 'text/plain');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return send(res, 200, festival.icon_image, festival.icon_mime);
});

// ---------- guests ----------

async function guestState(req, festival) {
  const state = await publicState(festival);
  const owned = await ownedTeams(req, festival);
  const chosen = cookies(req)[teamCookie(festival)];
  const visible = new Set(state.teams.map((team) => team.id));
  return {
    ...state,
    me: {
      teamId: visible.has(chosen) ? chosen : null,
      ownedTeamIds: owned.filter((team) => !team.hidden).map((team) => team.id),
    },
    canCreateTeam: isOpen(festival) && theme(festival).guestTeams,
  };
}

on('GET', `/api/p/${ID}/state`, async (req, res, [publicId]) => {
  const festival = await need(byPublicId(publicId), 'Fest nicht gefunden');
  sendNoStore(res, 200, await guestState(req, festival));
});

on('POST', `/api/p/${ID}/me`, async (req, res, [publicId]) => {
  const festival = await need(byPublicId(publicId), 'Fest nicht gefunden');
  const { teamId } = await readJson(req);
  if (teamId) {
    const team = await need(teamById(festival, teamId), 'Team nicht gefunden');
    setCookie(res, teamCookie(festival), team.id, cookieAge(festival));
  } else {
    setCookie(res, teamCookie(festival), '', 0);
  }
  sendNoStore(res, 200, { ok: true });
});

on('POST', `/api/p/${ID}/teams`, async (req, res, [publicId]) => {
  const festival = await need(byPublicId(publicId), 'Fest nicht gefunden');
  assertOpen(festival);
  if (!theme(festival).guestTeams) fail(403, 'Teams können nur an der Kasse angelegt werden');
  const body = await readJson(req);
  rateLimit(`team:${clientIp(req)}`, 10, 10 * 60 * 1000);
  const { team, ownerToken } = await createTeam(festival, body, 'guest');
  addOwnerToken(req, res, festival, ownerToken);
  setCookie(res, teamCookie(festival), team.id, cookieAge(festival));
  await emit(festival);
  sendNoStore(res, 201, { id: team.id });
});

async function ownedTeam(req, festival, teamId) {
  const team = (await ownedTeams(req, festival)).find((row) => row.id === teamId);
  if (!team) fail(403, 'Nur der Team-Owner darf das');
  return team;
}

on('PATCH', `/api/p/${ID}/teams/${ID}`, async (req, res, [publicId, teamId]) => {
  const festival = await need(byPublicId(publicId), 'Fest nicht gefunden');
  assertOpen(festival);
  const team = await ownedTeam(req, festival, teamId);
  const body = await readJson(req);
  await updateTeam(festival, team, { name: body.name, color: body.color });
  await emit(festival);
  sendNoStore(res, 200, { ok: true });
});

on('GET', `/api/p/${ID}/teams/${ID}/owner-link`, async (req, res, [publicId, teamId]) => {
  const festival = await need(byPublicId(publicId), 'Fest nicht gefunden');
  const team = await ownedTeam(req, festival, teamId);
  sendNoStore(res, 200, { url: ownerLink(festival, team), name: team.name });
});

on('GET', `/p/${ID}/o/${ID}`, async (req, res, [publicId, token]) => {
  const festival = await byPublicId(publicId);
  const [team] = festival ? await teamsByOwnerTokens(festival, [token]) : [];
  if (!team) {
    res.writeHead(302, { Location: festival ? `/p/${publicId}?owner=invalid` : '/', 'Cache-Control': 'no-store' });
    return res.end();
  }
  addOwnerToken(req, res, festival, token);
  setCookie(res, teamCookie(festival), team.id, cookieAge(festival));
  res.writeHead(302, { Location: `/p/${publicId}?owner=1`, 'Cache-Control': 'no-store' });
  return res.end();
});

// ---------- counters ----------

async function counterFestival(token) {
  return need(byCounterToken(token), 'Kassen-Link ungültig');
}

async function currentDevice(req, festival) {
  return deviceById(festival, cookies(req)[deviceCookie(festival)]);
}

async function requireDevice(req, festival) {
  const device = await currentDevice(req, festival);
  if (!device) fail(401, 'Bitte zuerst einen Namen für diese Kasse festlegen');
  return device;
}

on('GET', `/api/t/${ID}/state`, async (req, res, [token]) => {
  const festival = await counterFestival(token);
  const device = await currentDevice(req, festival);
  const state = await publicState(festival);
  sendNoStore(res, 200, {
    ...state,
    device: device && { id: device.id, name: device.name },
    recent: device ? await recentForDevice(festival, device) : [],
  });
});

on('POST', `/api/t/${ID}/device`, async (req, res, [token]) => {
  const festival = await counterFestival(token);
  const body = await readJson(req);
  rateLimit(`device:${clientIp(req)}`, 20, 10 * 60 * 1000);
  const device = await registerDevice(festival, body, await currentDevice(req, festival));
  setCookie(res, deviceCookie(festival), device.id, cookieAge(festival));
  sendNoStore(res, 200, { id: device.id, name: device.name });
});

on('POST', `/api/t/${ID}/entries`, async (req, res, [token]) => {
  const festival = await counterFestival(token);
  assertOpen(festival);
  const device = await requireDevice(req, festival);
  const entry = await addEntry(festival, device, await readJson(req));
  await emit(festival);
  sendNoStore(res, 201, entry);
});

on('POST', `/api/t/${ID}/entries/${ID}/undo`, async (req, res, [token, id]) => {
  const festival = await counterFestival(token);
  assertOpen(festival);
  const device = await requireDevice(req, festival);
  await undoEntry(festival, id, { device, by: `Kasse ${device.name}` });
  await emit(festival);
  sendNoStore(res, 200, { ok: true });
});

on('POST', `/api/t/${ID}/teams`, async (req, res, [token]) => {
  const festival = await counterFestival(token);
  assertOpen(festival);
  await requireDevice(req, festival);
  const { team } = await createTeam(festival, await readJson(req), 'counter');
  await emit(festival);
  sendNoStore(res, 201, { id: team.id });
});

on('PATCH', `/api/t/${ID}/teams/${ID}`, async (req, res, [token, teamId]) => {
  const festival = await counterFestival(token);
  assertOpen(festival);
  await requireDevice(req, festival);
  const team = await need(teamById(festival, teamId), 'Team nicht gefunden');
  const body = await readJson(req);
  await updateTeam(festival, team, { name: body.name, color: body.color });
  await emit(festival);
  sendNoStore(res, 200, { ok: true });
});

on('GET', `/api/t/${ID}/teams/${ID}/owner-link`, async (req, res, [token, teamId]) => {
  const festival = await counterFestival(token);
  await requireDevice(req, festival);
  const team = await need(teamById(festival, teamId), 'Team nicht gefunden');
  sendNoStore(res, 200, { url: ownerLink(festival, team), name: team.name });
});

// ---------- festival owner ----------

async function manageFestival(token) {
  return need(byManageToken(token), 'Verwaltungs-Link ungültig');
}

async function deviceDrinks(festival) {
  const { rows } = await query(`
    SELECT e.device_id, v.name AS device, d.name AS drink, d.emoji, sum(e.qty)::int AS count, sum(e.points)::int AS points
    FROM entry e JOIN drink_type d ON d.id = e.drink_type_id LEFT JOIN device v ON v.id = e.device_id
    WHERE e.festival_id = $1 AND e.undone_at IS NULL
    GROUP BY e.device_id, v.name, d.id ORDER BY v.name NULLS LAST, d.sort`, [festival.id]);
  return rows;
}

async function manageState(festival) {
  const [state, stats, teams, drinks, devices, perDevice] = await Promise.all([
    publicState(festival), ownerStats(festival), listTeams(festival), listDrinks(festival), listDevices(festival), deviceDrinks(festival),
  ]);
  return {
    ...state,
    stats,
    links: links(festival),
    allTeams: teams,
    allDrinks: drinks,
    devices,
    deviceDrinks: perDevice,
  };
}

on('GET', `/api/m/${ID}/state`, async (req, res, [token]) => {
  const festival = await manageFestival(token);
  await touch(festival.id);
  sendNoStore(res, 200, await manageState(festival));
});

on('PATCH', `/api/m/${ID}/festival`, async (req, res, [token]) => {
  const festival = await manageFestival(token);
  assertOpen(festival);
  await updateFestival(festival, await readJson(req));
  await emit(festival);
  sendNoStore(res, 200, { ok: true });
});

on('PUT', `/api/m/${ID}/icon`, async (req, res, [token]) => {
  const festival = await manageFestival(token);
  assertOpen(festival);
  await setIcon(festival, await readJson(req, MAX_ICON_BODY));
  await emit(festival);
  sendNoStore(res, 200, { ok: true });
});

on('POST', `/api/m/${ID}/teams`, async (req, res, [token]) => {
  const festival = await manageFestival(token);
  assertOpen(festival);
  const { team } = await createTeam(festival, await readJson(req), 'owner');
  await emit(festival);
  sendNoStore(res, 201, { id: team.id });
});

on('PATCH', `/api/m/${ID}/teams/${ID}`, async (req, res, [token, teamId]) => {
  const festival = await manageFestival(token);
  assertOpen(festival);
  const team = await need(teamById(festival, teamId), 'Team nicht gefunden');
  await updateTeam(festival, team, await readJson(req));
  await emit(festival);
  sendNoStore(res, 200, { ok: true });
});

on('DELETE', `/api/m/${ID}/teams/${ID}`, async (req, res, [token, teamId]) => {
  const festival = await manageFestival(token);
  assertOpen(festival);
  const team = await need(teamById(festival, teamId), 'Team nicht gefunden');
  await deleteTeam(festival, team);
  await emit(festival);
  sendNoStore(res, 200, { ok: true });
});

on('POST', `/api/m/${ID}/teams/${ID}/merge`, async (req, res, [token, teamId]) => {
  const festival = await manageFestival(token);
  assertOpen(festival);
  const team = await need(teamById(festival, teamId), 'Team nicht gefunden');
  const { into } = await readJson(req);
  const target = await need(teamById(festival, into), 'Zielteam nicht gefunden');
  await mergeTeam(festival, team, target);
  await emit(festival);
  sendNoStore(res, 200, { ok: true });
});

on('GET', `/api/m/${ID}/teams/${ID}/owner-link`, async (req, res, [token, teamId]) => {
  const festival = await manageFestival(token);
  const team = await need(teamById(festival, teamId), 'Team nicht gefunden');
  sendNoStore(res, 200, { url: ownerLink(festival, team), name: team.name });
});

on('POST', `/api/m/${ID}/teams/${ID}/owner-token`, async (req, res, [token, teamId]) => {
  const festival = await manageFestival(token);
  const team = await need(teamById(festival, teamId), 'Team nicht gefunden');
  sendNoStore(res, 200, { url: await rotateOwnerToken(festival, team), name: team.name });
});

on('POST', `/api/m/${ID}/drinks`, async (req, res, [token]) => {
  const festival = await manageFestival(token);
  assertOpen(festival);
  const drink = await createDrink(festival, await readJson(req));
  await emit(festival);
  sendNoStore(res, 201, { id: drink.id });
});

on('PATCH', `/api/m/${ID}/drinks/${ID}`, async (req, res, [token, drinkId]) => {
  const festival = await manageFestival(token);
  assertOpen(festival);
  const drink = await need(drinkById(festival, drinkId), 'Getränk nicht gefunden');
  await updateDrink(festival, drink, await readJson(req));
  await emit(festival);
  sendNoStore(res, 200, { ok: true });
});

on('DELETE', `/api/m/${ID}/drinks/${ID}`, async (req, res, [token, drinkId]) => {
  const festival = await manageFestival(token);
  assertOpen(festival);
  const drink = await need(drinkById(festival, drinkId), 'Getränk nicht gefunden');
  await deleteDrink(festival, drink);
  await emit(festival);
  sendNoStore(res, 200, { ok: true });
});

on('POST', `/api/m/${ID}/counter-token`, async (req, res, [token]) => {
  const festival = await manageFestival(token);
  sendNoStore(res, 200, { counterUrl: await rotateCounterToken(festival) });
});

function entryFilters(searchParams) {
  return Object.fromEntries(['device', 'team', 'drink', 'from', 'to'].map((key) => [key, searchParams.get(key)]));
}

on('GET', `/api/m/${ID}/entries`, async (req, res, [token], searchParams) => {
  const festival = await manageFestival(token);
  sendNoStore(res, 200, { entries: await listEntries(festival, entryFilters(searchParams), 1000) });
});

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

on('GET', `/api/m/${ID}/entries.csv`, async (req, res, [token], searchParams) => {
  const festival = await manageFestival(token);
  await touch(festival.id);
  const entries = await listEntries(festival, entryFilters(searchParams), 100000);
  const lines = [['Zeit', 'Kasse', 'Team', 'Getränk', 'Menge', 'Punkte', 'Storniert'].join(';')];
  for (const e of entries.reverse()) {
    lines.push([
      new Date(e.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
      e.device ?? '', e.team, e.drink, e.qty, e.points,
      e.undone_at ? new Date(e.undone_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : '',
    ].map(csvCell).join(';'));
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', 'attachment; filename="drinktracker-buchungen.csv"');
  send(res, 200, `\ufeff${lines.join('\r\n')}\r\n`, 'text/csv; charset=utf-8');
});

on('POST', `/api/m/${ID}/entries/${ID}/undo`, async (req, res, [token, id]) => {
  const festival = await manageFestival(token);
  assertOpen(festival);
  await undoEntry(festival, id, { by: 'Veranstalter' });
  await emit(festival);
  sendNoStore(res, 200, { ok: true });
});

on('GET', `/api/m/${ID}/report`, async (req, res, [token]) => {
  const festival = await manageFestival(token);
  await touch(festival.id);
  sendNoStore(res, 200, { ...(await manageState(festival)), entries: await listEntries(festival, {}, 100000) });
});

on('POST', `/api/m/${ID}/close`, async (req, res, [token]) => {
  const festival = await manageFestival(token);
  assertOpen(festival);
  await closeFestival(festival.id);
  await emit(festival);
  sendNoStore(res, 200, { ok: true });
});

// ---------- platform admins (OIDC) ----------

export const adminEnabled = authEnabled || DEV_ADMIN;

export function isAdmin(req) {
  return DEV_ADMIN || Boolean(getSession(req));
}

function requireAdmin(req) {
  if (!isAdmin(req)) fail(401, 'Nicht angemeldet');
}

if (authEnabled) {
  on('GET', '/admin/login', (req, res) => login(req, res));
  on('GET', '/admin/callback', (req, res) => callback(req, res));
  on('POST', '/admin/logout', (req, res) => logout(req, res));
}

if (adminEnabled) {
  on('GET', '/admin/api/festivals', async (req, res) => {
    requireAdmin(req);
    const festivals = await listFestivals();
    sendNoStore(res, 200, {
      user: DEV_ADMIN ? 'dev' : getSession(req).name,
      festivals: festivals.map((f) => ({
        id: f.id,
        name: f.name,
        iconEmoji: f.icon_emoji,
        iconUrl: f.icon_mime ? `/i/${f.public_id}?v=${f.icon_version}` : null,
        open: isOpen(f),
        createdAt: f.created_at,
        expiresAt: f.expires_at,
        closedAt: f.closed_at,
        lastActivityAt: f.last_activity_at,
        teams: f.team_count,
        devices: f.device_count,
        drinks: f.drink_count,
        links: links(f),
      })),
    });
  });

  on('POST', `/admin/api/festivals/${ID}/close`, async (req, res, [id]) => {
    requireAdmin(req);
    const festival = await need(byId(id), 'Fest nicht gefunden');
    await closeFestival(festival.id);
    await emit(festival);
    sendNoStore(res, 200, { ok: true });
  });

  on('DELETE', `/admin/api/festivals/${ID}`, async (req, res, [id]) => {
    requireAdmin(req);
    const festival = await need(byId(id), 'Fest nicht gefunden');
    await deleteFestival(festival.id);
    await emit(festival);
    sendNoStore(res, 200, { ok: true });
  });

  on('GET', '/admin/api/settings', async (req, res) => {
    requireAdmin(req);
    sendNoStore(res, 200, { creationEnabled: await getSetting('creation_enabled', true) });
  });

  on('PUT', '/admin/api/settings', async (req, res) => {
    requireAdmin(req);
    const { creationEnabled } = await readJson(req);
    if (typeof creationEnabled !== 'boolean') fail(400, 'creationEnabled fehlt');
    await setSetting('creation_enabled', creationEnabled);
    sendNoStore(res, 200, { creationEnabled });
  });
}

// ---------- page guards ----------

export async function pageAllowed(kind, value) {
  if (kind === 'm') return Boolean(await byManageToken(value));
  if (kind === 't') return Boolean(await byCounterToken(value));
  if (kind === 'p') return Boolean(await byPublicId(value));
  return false;
}
