import {
  $, el, fill, api, applyTheme, iconNode, qrElement, connectLive, animateList, fmtNum, showError,
} from '/common.js';

const token = location.pathname.split('/')[2];
const app = $('#app');
let publicUrl;
let lastPoints = new Map();
let qrUrl;
let qrNode;

const head = el('header', { className: 'screen-head' });
const board = el('div', { className: 'board' });
const more = el('div', { className: 'board-more' });
const side = el('aside', { className: 'side' });
const main = el('div', { className: 'screen-main' }, el('div', { className: 'stack-sm' }, board, more), side);
fill(app, el('main', { className: 'screen' }, head, main));

function renderHead(festival) {
  fill(head, 
    iconNode(festival),
    el('div', { className: 'grow' },
      el('h1', { text: festival.name }),
      (festival.theme.subtitle || !festival.open) && el('p', { text: festival.open ? festival.theme.subtitle : 'Endstand' })),
  );
}

function rowsThatFit(total) {
  const sample = board.firstElementChild;
  const rowHeight = sample ? sample.getBoundingClientRect().height : 72;
  const gap = parseFloat(getComputedStyle(board).rowGap) || 8;
  const available = main.getBoundingClientRect().height;
  const fit = (height) => Math.max(3, Math.floor((height + gap) / (rowHeight + gap)));
  return total > fit(available) ? fit(available - 40) : total;
}

function boardRow(team, max, barIcon) {
  const width = max > 0 ? `${Math.max(4, (team.points / max) * 100)}%` : '4%';
  const row = el('div', {
    className: `board-row${team.rank <= 3 ? ` medal-${team.rank}` : ''}`,
    dataset: { id: team.id },
    style: { '--team': team.color, '--w': width },
  },
  el('div', { className: 'rank-no', text: team.rank }),
  el('div', { className: 'name' }, el('i', { className: 'rank-swatch' }), el('span', { text: team.name })),
  el('div', { className: 'track' },
    el('div', { className: 'fill' }),
    barIcon && el('span', { className: 'bar-icon', text: barIcon, 'aria-hidden': 'true' })),
  el('div', { className: 'value' }, fmtNum(team.points), team.points !== team.drinks && el('small', { text: `${fmtNum(team.drinks)} Getränke` })));
  if (lastPoints.has(team.id) && lastPoints.get(team.id) < team.points) row.classList.add('bump');
  return row;
}

function renderBoard(state) {
  const { teams, festival } = state;
  const max = teams[0]?.points ?? 0;
  const portrait = window.matchMedia('(max-width: 900px), (orientation: portrait)').matches;
  let limit = teams.length;
  if (!portrait) {
    if (!board.firstElementChild && teams.length) board.append(boardRow(teams[0], max, ''));
    limit = rowsThatFit(teams.length);
  }
  const shown = teams.slice(0, limit);
  animateList(board, () => {
    fill(board, ...shown.map((team) => boardRow(team, max, festival.theme.barIcon)));
  });
  more.textContent = teams.length > shown.length ? `+ ${teams.length - shown.length} weitere Teams` : '';
  more.hidden = !more.textContent;
  if (!teams.length) {
    fill(board, el('div', { className: 'card center' },
      el('p', { className: 'big-num', text: '🍻' }),
      el('p', { text: 'Noch keine Teams – scannt den QR-Code und gründet euer Team!' })));
  }
  lastPoints = new Map(teams.map((team) => [team.id, team.points]));
}

function renderPodium(state) {
  const top = state.teams.filter((team) => team.rank <= 3).slice(0, 3);
  const podium = el('div', { className: 'podium' }, top.map((team, index) => el('div', {
    className: `step p${index + 1}`,
    style: { '--team': team.color },
  },
  el('div', { className: 'who', text: team.name }),
  el('div', { className: 'pts', text: `${fmtNum(team.points)} Punkte` }),
  el('div', { className: 'block', text: team.rank }))));
  const rest = state.teams.slice(3);
  fill(board, podium, ...rest.slice(0, 6).map((team) => boardRow(team, state.teams[0]?.points ?? 0, '')));
  more.textContent = rest.length > 6 ? `+ ${rest.length - 6} weitere Teams` : '';
  more.hidden = !more.textContent;
}

function renderSide(state) {
  const { festival } = state;
  if (publicUrl !== qrUrl) {
    qrUrl = publicUrl;
    qrNode = qrElement(publicUrl);
  }
  const showQr = festival.theme.showPublicQr && festival.open;
  fill(side,
    showQr && el('div', { className: 'card join' },
      el('h3', { text: 'Scan & wähl dein Team' }),
      qrNode,
      el('code', { text: publicUrl.replace(/^https?:\/\//, '') })));
  main.classList.toggle('no-side', !side.childElementCount);
}

let current;

function render(state) {
  current = state;
  applyTheme(state.festival);
  renderHead(state.festival);
  if (state.festival.open) renderBoard(state);
  else renderPodium(state);
  renderSide(state);
}

async function load() {
  const state = await api(`/api/m/${token}/state`);
  publicUrl = state.links.publicUrl;
  render(state);
  return state;
}

window.addEventListener('resize', () => current && render(current));
document.addEventListener('dblclick', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
});

try {
  const state = await load();
  connectLive(state.festival.publicId, {
    onState: render,
    onRefresh: load,
    onDeleted: () => location.reload(),
  });
} catch (err) {
  showError(err);
}
