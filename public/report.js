import {
  $, el, fill, api, iconNode, fmtNum, showError,
} from '/common.js';

const token = location.pathname.split('/')[2];
const app = $('#app');
const fmt = (iso) => new Date(iso).toLocaleString('de-DE', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

const table = (headers, rows, numeric = []) => el('table', {},
  el('thead', {}, el('tr', {}, headers.map((h, i) => el('th', { className: numeric.includes(i) ? 'num' : '', text: h })))),
  el('tbody', {}, rows.map((row) => el('tr', { className: row.className ?? '' }, row.cells.map((cell, i) => el('td', { className: numeric.includes(i) ? 'num' : '', text: cell }))))));

function render(data) {
  const { festival, stats, teams, allTeams, allDrinks, devices, deviceDrinks, entries } = data;
  document.title = `Bericht ${festival.name} · DrinkTracker`;
  const hidden = allTeams.filter((team) => team.hidden);
  const byDevice = new Map();
  for (const row of deviceDrinks) {
    const key = row.device ?? '(gelöschte Kasse)';
    if (!byDevice.has(key)) byDevice.set(key, []);
    byDevice.get(key).push(row);
  }
  const chronological = [...entries].reverse();

  fill(app, el('main', { className: 'page report' },
    el('div', { className: 'row between no-print', style: { 'margin-bottom': '16px' } },
      el('span', { className: 'muted', text: 'Tipp: Im Druckdialog „Als PDF sichern“ wählen.' }),
      el('button', { type: 'button', className: 'btn primary', text: 'Drucken / Als PDF sichern', onClick: () => window.print() })),
    el('header', { className: 'row' },
      iconNode(festival),
      el('div', {},
        el('h1', { text: festival.name }),
        el('p', { className: 'muted', text: `Bericht vom ${fmt(new Date().toISOString())} · Fest ${festival.open ? 'läuft noch' : `beendet am ${fmt(festival.closedAt ?? festival.expiresAt)}`} · gestartet ${fmt(festival.createdAt)}` }))),
    el('section', {},
      el('h2', { text: 'Übersicht' }),
      table(['Getränke', 'Punkte', 'Teams', 'Kassen', 'Buchungen'], [{
        cells: [fmtNum(stats.totalDrinks), fmtNum(stats.totalPoints), stats.teamCount, devices.length, entries.filter((e) => !e.undone_at).length],
      }], [0, 1, 2, 3, 4])),
    el('section', {},
      el('h2', { text: festival.open ? 'Zwischenstand' : 'Endstand' }),
      table(['Platz', 'Team', 'Getränke', 'Punkte'], teams.map((team) => ({
        cells: [team.rank, team.name, fmtNum(team.drinks), fmtNum(team.points)],
      })), [0, 2, 3]),
      hidden.length > 0 && el('p', { className: 'muted small', text: `Ausgeblendete Teams (nicht im Ranking): ${hidden.map((t) => `${t.name} (${t.drinks})`).join(', ')}` })),
    el('section', {},
      el('h2', { text: 'Getränke' }),
      table(['Getränk', 'Punkte/Stück', 'Anzahl'], allDrinks.map((drink) => ({
        cells: [`${drink.emoji} ${drink.name}${drink.hidden ? ' (ausgeblendet)' : ''}`, drink.points, fmtNum(drink.drinks)],
      })), [1, 2])),
    el('section', {},
      el('h2', { text: 'Kassen' }),
      table(['Kasse', 'Getränk', 'Anzahl', 'Punkte'], [...byDevice.entries()].flatMap(([device, rows]) => rows.map((row, i) => ({
        cells: [i === 0 ? device : '', `${row.emoji} ${row.drink}`, fmtNum(row.count), fmtNum(row.points)],
      }))), [2, 3])),
    el('section', {},
      el('h2', { text: `Buchungsprotokoll (${entries.length})` }),
      table(['Zeit', 'Kasse', 'Team', 'Getränk', 'Menge', 'Punkte', 'Storno'], chronological.map((entry) => ({
        className: entry.undone_at ? 'undone' : '',
        cells: [
          fmt(entry.created_at), entry.device ?? '–', entry.team, `${entry.drink_emoji} ${entry.drink}`, entry.qty, entry.points,
          entry.undone_at ? `${fmt(entry.undone_at)}${entry.undone_by ? ` (${entry.undone_by})` : ''}` : '',
        ],
      })), [4, 5]))));
}

api(`/api/m/${token}/report`).then(render).catch(showError);
