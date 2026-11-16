import {
  $, el, fill, api, iconNode, showError, toast, confirmDialog, copyText, modal, fmtDateTime, fmtNum, fmtRemaining, fmtTime, auditTable,
} from '/common.js';

const REFRESH_MS = 10_000;
const app = $('#app');
let data;
let settings;
let filter = 'open';
let search = '';

async function load() {
  [data, settings] = await Promise.all([api('/admin/api/festivals'), api('/admin/api/settings')]);
  render();
}

async function action(path, method, success) {
  try {
    await api(path, method, method === 'DELETE' ? undefined : {});
    toast(success, { type: 'success' });
    await load();
  } catch (err) {
    showError(err);
  }
}

const stat = (value, label) => el('div', { className: 'stat' }, el('b', { text: value }), el('span', { text: label }));
const dot = (online) => el('i', { className: `presence${online ? ' on' : ''}`, title: online ? 'online' : 'offline' });

function linkButtons(links) {
  return [
    ['Verwaltung', links.manageUrl],
    ['Screen', links.screenUrl],
    ['Kasse', links.counterUrl],
    ['Gäste', links.publicUrl],
  ].map(([label, url]) => el('span', { className: 'row', style: { gap: '2px' } },
    el('a', { className: 'btn small secondary', href: url, target: '_blank', rel: 'noopener', text: label }),
    el('button', { type: 'button', className: 'icon-btn', title: `${label}-Link kopieren`, 'aria-label': `${label}-Link kopieren`, text: '⧉', onClick: () => copyText(url) })));
}

function liveLine(live) {
  return el('div', { className: 'row small' },
    dot(live.total > 0),
    el('b', { text: `${fmtNum(live.total)} verbunden` }),
    el('span', { className: 'muted', text: `· ${live.guest} Gäste · ${live.counter} Kassen · ${live.screen} Screens · ${live.manage} Verwaltung` }));
}

function counterList(counters) {
  if (!counters.length) return el('p', { className: 'muted small', text: 'Noch keine Kasse registriert.' });
  return el('ul', { className: 'list' }, counters.map((device) => el('li', { className: 'item' },
    dot(device.online),
    el('div', { className: 'title', text: device.name }),
    el('div', { className: 'meta', text: `${fmtNum(device.drinks)} Getränke · ${fmtNum(device.bookings)} Buchungen` }),
    el('div', { className: 'meta', text: `zuletzt aktiv ${fmtDateTime(device.last_seen_at)}${device.last_booking_at ? ` · letzte Buchung ${fmtTime(device.last_booking_at)}` : ''}` }))));
}

const table = (headers, rows, numeric = []) => el('div', { className: 'table-wrap' }, el('table', { className: 'log' },
  el('thead', {}, el('tr', {}, headers.map((h) => el('th', { text: h })))),
  el('tbody', {}, rows.map((cells) => el('tr', {}, cells.map((cell, i) => el('td', {
    dataset: { label: headers[i] }, className: numeric.includes(i) ? 'num' : '', text: cell,
  })))))));

async function showDetails(f) {
  let details;
  let auditRows;
  try {
    [details, { audit: auditRows }] = await Promise.all([
      api(`/admin/api/festivals/${f.id}`),
      api(`/admin/api/audit?festival=${f.id}`),
    ]);
  } catch (err) {
    showError(err);
    return;
  }
  const { stats, allTeams, allDrinks, devices, deviceDrinks, live } = details;
  const ranks = new Map(details.teams.map((team) => [team.id, team.rank]));
  const origin = { owner: 'Veranstalter', counter: 'Kasse', guest: 'Gast' };
  const online = new Set(live.counters.map((device) => device.id));
  modal(f.name, el('div', { className: 'stack' },
    el('div', { className: 'row' }, iconNode(f), el('div', { className: 'grow' },
      el('div', { className: 'muted small', text: f.open ? `läuft · noch ${fmtRemaining(f.expiresAt)}` : `beendet ${fmtDateTime(f.closedAt ?? f.expiresAt)}` }),
      el('div', { className: 'muted small', text: `gestartet ${fmtDateTime(f.createdAt)} · letzte Aktivität ${fmtDateTime(f.lastActivityAt)}${f.creatorIp ? ` · erstellt von IP ${f.creatorIp}` : ''}` }))),
    liveLine(live),
    el('div', { className: 'grid-3' },
      stat(fmtNum(stats.totalDrinks), 'Getränke'),
      stat(fmtNum(stats.totalPoints), 'Punkte'),
      stat(fmtNum(stats.lastHour), 'letzte Stunde'),
      stat(fmtNum(allTeams.length), 'Teams'),
      stat(fmtNum(devices.length), 'Kassen'),
      stat(stats.topDrink ? `${stats.topDrink.emoji} ${fmtNum(stats.topDrink.count)}` : '–', stats.topDrink ? `Top: ${stats.topDrink.name}` : 'Top-Getränk')),
    el('h3', { text: 'Kassen' }),
    devices.length ? table(['', 'Kasse', 'Getränke', 'Buchungen', 'Zuletzt aktiv', 'Je Getränk'], devices.map((device) => [
      online.has(device.id) ? '🟢' : '⚪', device.name, fmtNum(device.drinks), fmtNum(device.bookings), fmtDateTime(device.last_seen_at),
      deviceDrinks.filter((row) => row.device_id === device.id).map((row) => `${row.emoji} ${row.count}`).join('  '),
    ]), [2, 3]) : el('p', { className: 'muted', text: 'Keine Kassen.' }),
    el('h3', { text: 'Teams' }),
    allTeams.length ? table(['Platz', 'Team', 'Getränke', 'Punkte', 'Buchungen', 'Angelegt von'], allTeams
      .map((team) => ({ ...team, rank: ranks.get(team.id) }))
      .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
      .map((team) => [team.rank ?? 'ausgeblendet', team.name, fmtNum(team.drinks), fmtNum(team.points), fmtNum(team.entries), origin[team.created_by] ?? '']), [2, 3, 4])
      : el('p', { className: 'muted', text: 'Keine Teams.' }),
    el('h3', { text: 'Getränke' }),
    table(['Getränk', 'Punkte', 'Gebucht', 'Status'], allDrinks.map((drink) => [
      `${drink.emoji} ${drink.name}`, drink.points, fmtNum(drink.drinks), drink.hidden ? 'ausgeblendet' : 'aktiv',
    ]), [1, 2]),
    stats.recent.length > 0 && el('h3', { text: 'Zuletzt gebucht' }),
    stats.recent.length > 0 && el('ul', { className: 'recent' }, stats.recent.map((entry) => el('li', {},
      el('span', { text: entry.drink_emoji || '🥤' }),
      el('span', { className: 'grow' }, `${entry.qty}× ${entry.drink} · `, el('b', { text: entry.team })),
      el('span', { className: 'muted small', text: fmtTime(entry.created_at) })))),
    el('h3', { text: 'Audit-Log' }),
    auditTable(auditRows, { withIp: true }),
    el('h3', { text: 'Links' }),
    el('div', { className: 'row' }, linkButtons(f.links))), { wide: true });
}

function festivalCard(f) {
  return el('li', { className: 'card stack-sm' },
    el('div', { className: 'row' },
      iconNode(f),
      el('div', { className: 'grow' },
        el('b', { text: f.name }),
        el('div', {
          className: 'muted small',
          text: f.open
            ? `läuft · noch ${fmtRemaining(f.expiresAt)} · gestartet ${fmtDateTime(f.createdAt)}`
            : `beendet ${fmtDateTime(f.closedAt ?? f.expiresAt)} · letzte Aktivität ${fmtDateTime(f.lastActivityAt)}`,
        })),
      el('span', { className: `banner small ${f.open ? 'ok' : 'closed'}`, text: f.open ? 'aktiv' : 'beendet' })),
    liveLine(f.live),
    el('div', { className: 'muted small', text: `${fmtNum(f.teams)} Teams (${fmtNum(f.guestTeams)} von Gästen) · ${fmtNum(f.drinks)} Getränke · ${fmtNum(f.points)} Punkte · ${fmtNum(f.bookings)} Buchungen` }),
    el('details', {},
      el('summary', { text: `Kassen (${f.counters.filter((c) => c.online).length} von ${f.counters.length} online)` }),
      counterList(f.counters)),
    el('div', { className: 'row' }, linkButtons(f.links)),
    el('div', { className: 'row end' },
      el('button', { type: 'button', className: 'btn small secondary', text: 'Details', onClick: () => showDetails(f) }),
      el('a', { className: 'btn small primary', href: f.links.manageUrl, text: 'Bearbeiten' }),
      f.open && el('button', {
        type: 'button',
        className: 'btn small secondary',
        text: 'Schließen',
        onClick: async () => {
          if (await confirmDialog('Fest schließen?', `„${f.name}“ wird beendet. Buchungen sind danach nicht mehr möglich.`, 'Schließen', true)) {
            action(`/admin/api/festivals/${f.id}/close`, 'POST', 'Fest geschlossen');
          }
        },
      }),
      el('button', {
        type: 'button',
        className: 'btn small danger',
        text: 'Löschen',
        onClick: async () => {
          if (await confirmDialog('Fest löschen?', `„${f.name}“ und alle Buchungen werden endgültig gelöscht.`, 'Endgültig löschen', true)) {
            action(`/admin/api/festivals/${f.id}`, 'DELETE', 'Fest gelöscht');
          }
        },
      })));
}

const list = el('ul', { className: 'list' });

function renderList() {
  const term = search.toLowerCase();
  const festivals = data.festivals
    .filter((f) => filter === 'all' || (filter === 'open' ? f.open : !f.open))
    .filter((f) => !term || f.name.toLowerCase().includes(term) || f.counters.some((c) => c.name.toLowerCase().includes(term)))
    .sort((a, b) => b.live.total - a.live.total || new Date(b.createdAt) - new Date(a.createdAt));
  fill(list, festivals.length ? festivals.map(festivalCard) : el('li', { className: 'muted', text: 'Keine Feste.' }));
}

function render() {
  if (document.activeElement?.matches('input[type="search"]') && app.contains(document.activeElement)) {
    renderList();
    return;
  }
  const { summary } = data;
  fill(app,
    el('header', { className: 'topbar' },
      el('img', { className: 'fest-icon', src: '/favicon.svg', alt: '' }),
      el('div', { className: 'grow' }, el('h1', { text: 'DrinkTracker Admin' }), el('div', { className: 'sub', text: `angemeldet als ${data.user} · aktualisiert ${fmtTime(new Date().toISOString())}` })),
      el('button', {
        type: 'button',
        className: 'btn small secondary',
        text: 'Audit-Log',
        onClick: async () => {
          try {
            const { audit: rows } = await api('/admin/api/audit?limit=1000');
            modal('Audit-Log (alle Feste)', auditTable(rows, { withFestival: true, withIp: true }), { wide: true });
          } catch (err) {
            showError(err);
          }
        },
      }),
      el('button', {
        type: 'button',
        className: 'btn small secondary',
        text: 'Abmelden',
        onClick: async () => {
          try {
            const { url } = await api('/admin/logout', 'POST', {});
            location.href = url;
          } catch (err) {
            showError(err);
          }
        },
      })),
    el('main', { className: 'page stack' },
      el('div', { className: 'grid-3' },
        stat(fmtNum(summary.running), 'Feste laufen'),
        stat(fmtNum(summary.connected), 'Geräte verbunden'),
        stat(fmtNum(summary.guests), 'Gäste online'),
        stat(fmtNum(summary.countersOnline), 'Kassen online'),
        stat(fmtNum(summary.drinksRunning), 'Getränke (laufende Feste)'),
        stat(fmtNum(summary.festivals), 'Feste gesamt')),
      el('label', { className: 'switch card' },
        el('input', {
          type: 'checkbox',
          checked: settings.creationEnabled,
          onChange: async (event) => {
            try {
              settings = await api('/admin/api/settings', 'PUT', { creationEnabled: event.target.checked });
              toast(settings.creationEnabled ? 'Neue Feste sind wieder erlaubt' : 'Anlegen neuer Feste gestoppt', { type: 'success' });
            } catch (err) {
              showError(err);
              event.target.checked = !event.target.checked;
            }
          },
        }),
        el('span', {}, el('b', { text: 'Neue Feste dürfen angelegt werden' }), el('br'), el('span', { className: 'muted small', text: 'Laufende Feste sind davon nicht betroffen.' }))),
      el('div', { className: 'row' },
        el('div', { className: 'grow' }, el('input', {
          type: 'search',
          placeholder: 'Fest oder Kasse suchen …',
          value: search,
          onInput: (event) => {
            search = event.target.value;
            renderList();
          },
        })),
        el('select', {
          'aria-label': 'Filter',
          style: { width: 'auto' },
          onChange: (event) => {
            filter = event.target.value;
            renderList();
          },
        }, [['open', 'Laufend'], ['closed', 'Beendet'], ['all', 'Alle']].map(([value, text]) => el('option', { value, text, selected: filter === value })))),
      list));
  renderList();
}

load().catch(showError);
setInterval(() => {
  if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) load().catch(() => {});
}, REFRESH_MS);
