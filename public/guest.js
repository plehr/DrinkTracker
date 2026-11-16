import {
  $, el, fill, api, applyTheme, iconNode, connectLive, toast, showError, showQr, promptDialog, gaps, fmtNum, TEAM_COLORS,
  animateList, debounce,
} from '/common.js';

const [, , publicId, linkKind, linkTeamId] = location.pathname.split('/');
const invitedTeamId = linkKind === 'team' ? linkTeamId : null;
if (invitedTeamId) history.replaceState(null, '', `/p/${publicId}`);
const app = $('#app');
let state;
let me = { teamId: null, ownedTeamIds: [] };
let canCreateTeam = false;
let picking = false;
let search = '';

const header = el('header', { className: 'topbar' });
const body = el('main', { className: 'page page-narrow stack' });
const rankingList = el('ol', { className: 'ranking' });
fill(app, header, body);

const params = new URLSearchParams(location.search);
if (params.get('owner') === '1') toast('Du bist jetzt Team-Owner 🎉', { type: 'success' });
if (params.get('owner') === 'invalid') toast('Dieser Owner-Link ist nicht mehr gültig', { type: 'error' });
if (params.has('owner')) history.replaceState(null, '', location.pathname);

async function choose(teamId) {
  try {
    await api(`/api/p/${publicId}/me`, 'POST', { teamId });
    me = { ...me, teamId };
    picking = false;
    render();
  } catch (err) {
    showError(err);
  }
}

async function rename(team) {
  const name = await promptDialog('Team umbenennen', 'Neuer Teamname', team.name);
  if (!name || name === team.name) return;
  try {
    await api(`/api/p/${publicId}/teams/${team.id}`, 'PATCH', { name });
    toast('Name geändert', { type: 'success' });
    await load();
  } catch (err) {
    showError(err);
  }
}

async function ownerQr(team) {
  try {
    const { url } = await api(`/api/p/${publicId}/teams/${team.id}/owner-link`);
    showQr(`Owner-Zugang: ${team.name}`, url, 'Wer diesen Code scannt, darf den Teamnamen ebenfalls ändern und den Zugang weitergeben.');
  } catch (err) {
    showError(err);
  }
}

async function shareTeam(team) {
  const url = `${location.origin}/p/${publicId}/team/${team.id}`;
  const text = `Mach mit bei Team „${team.name}“ – ${state.festival.name}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: team.name, text, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  showQr(`Team teilen: ${team.name}`, url, 'Wer diesen Link öffnet, landet direkt bei eurem Team.');
}

function createForm() {
  let color = TEAM_COLORS[(state?.teams.length ?? 0) % TEAM_COLORS.length];
  const name = el('input', { type: 'text', maxLength: 40, required: true, placeholder: 'Teamname', autocomplete: 'off' });
  const colors = el('div', { className: 'color-picker', role: 'group', 'aria-label': 'Teamfarbe' });
  const renderColors = () => fill(colors, ...TEAM_COLORS.map((c) => el('button', {
    type: 'button',
    'aria-label': `Farbe ${c}`,
    'aria-pressed': String(c === color),
    style: { background: c },
    onClick: () => {
      color = c;
      renderColors();
    },
  })));
  renderColors();
  const submit = el('button', { type: 'submit', className: 'btn accent block', text: 'Team gründen' });
  return el('form', {
    className: 'card stack',
    onSubmit: async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const { id } = await api(`/api/p/${publicId}/teams`, 'POST', { name: name.value, color });
        me = { teamId: id, ownedTeamIds: [...me.ownedTeamIds, id] };
        picking = false;
        toast('Team gegründet – du bist Team-Owner 🎉', { type: 'success' });
        await load();
      } catch (err) {
        showError(err);
        submit.disabled = false;
      }
    },
  },
  el('h2', { text: 'Neues Team gründen' }),
  name,
  colors,
  submit);
}

function pickView() {
  const list = el('div', { className: 'team-pick' });
  const fillList = () => {
    const term = search.toLowerCase();
    const teams = [...state.teams].sort((a, b) => a.name.localeCompare(b.name, 'de')).filter((team) => team.name.toLowerCase().includes(term));
    fill(list, ...teams.map((team) => el('button', { type: 'button', onClick: () => choose(team.id) },
      el('i', { className: 'rank-swatch', style: { '--team': team.color } }),
      el('span', { className: 'grow', text: team.name }),
      el('span', { className: 'muted', text: `#${team.rank}` }))));
    if (!teams.length) list.append(el('p', { className: 'muted', text: state.teams.length ? 'Kein Team gefunden.' : 'Noch keine Teams.' }));
  };
  const input = el('input', {
    type: 'search', placeholder: 'Team suchen …', value: search, autocomplete: 'off',
    onInput: (event) => {
      search = event.target.value;
      fillList();
    },
  });
  fillList();
  return el('div', { className: 'stack' },
    el('div', { className: 'card stack' },
      el('h2', { text: 'Wähle dein Team' }),
      state.teams.length > 6 && input,
      list,
      me.teamId && el('button', { type: 'button', className: 'btn secondary', text: 'Abbrechen', onClick: () => { picking = false; render(); } })),
    canCreateTeam && createForm());
}

function ownerBanner() {
  const owned = state.teams.filter((team) => me.ownedTeamIds.includes(team.id));
  if (!owned.length) return null;
  return el('div', { className: 'card stack-sm' },
    el('p', {}, 'Hey, du bist Team-Owner von ', ...owned.flatMap((team, index) => [index ? ', ' : '', el('b', { text: team.name })]), '!'),
    ...owned.map((team) => el('div', { className: 'row' },
      owned.length > 1 && el('span', { className: 'grow', text: team.name }),
      state.festival.open && el('button', { type: 'button', className: 'btn small secondary', text: 'Name ändern', onClick: () => rename(team) }),
      el('button', { type: 'button', className: 'btn small secondary', text: 'Owner-QR zeigen', onClick: () => ownerQr(team) }))));
}

function myTeamCard() {
  const info = gaps(state.teams, me.teamId);
  if (!info) return null;
  const { me: team, ahead, behind } = info;
  const total = state.teams.length;
  const open = state.festival.open;
  return el('section', { className: 'my-team', style: { '--team': team.color } },
    el('div', { className: 'muted small', text: open ? 'Dein Team' : 'Endstand – euer Team' }),
    el('div', { className: 'team-name', text: team.name }),
    el('div', { className: 'place' }, `Platz ${team.rank}`, el('small', { text: ` von ${total}` })),
    el('div', { className: 'kpis' },
      el('div', { className: 'kpi' }, el('b', { text: fmtNum(team.drinks) }), el('span', { text: 'Getränke' })),
      el('div', { className: 'kpi' }, el('b', { text: fmtNum(team.points) }), el('span', { text: 'Punkte' }))),
    el('div', { className: 'gap-info' },
      team.rank === 1 && !ahead
        ? el('p', { text: behind ? `🏆 Ihr führt mit ${fmtNum(behind.diff)} Punkten Vorsprung!` : '🏆 Ihr seid ganz vorne!' })
        : ahead && el('p', { text: `Noch ${fmtNum(ahead.diff)} Punkte bis Platz ${ahead.team.rank} (${ahead.team.name})` }),
      behind && team.rank !== 1 && el('p', { className: 'muted', text: `${fmtNum(behind.diff)} Punkte Vorsprung auf ${behind.team.name}` })),
    el('div', { className: 'row', style: { 'justify-content': 'center', 'margin-top': '12px' } },
      el('button', { type: 'button', className: 'btn small secondary', text: 'Team teilen', onClick: () => shareTeam(team) }),
      open && el('button', { type: 'button', className: 'btn small secondary', text: 'Team wechseln', onClick: () => { picking = true; render(); } })));
}

function renderRanking() {
  animateList(rankingList, () => {
    const max = state.teams[0]?.points ?? 0;
    fill(rankingList, ...state.teams.map((team) => el('li', {
      className: `rank-row${team.id === me.teamId ? ' me' : ''}${team.rank <= 3 ? ` medal-${team.rank}` : ''}`,
      dataset: { id: team.id },
      style: { '--team': team.color, '--w': max ? `${(team.points / max) * 100}%` : '0%' },
    },
    el('div', { className: 'rank-no', text: team.rank }),
    el('div', { className: 'rank-name' }, el('i', { className: 'rank-swatch' }), el('span', { text: team.name })),
    el('div', { className: 'rank-value', text: fmtNum(team.points) }),
    el('div', { className: 'rank-bar' }, el('i')))));
  });
}

function render() {
  if (!state) return;
  const { festival } = state;
  applyTheme(festival);
  fill(header, iconNode(festival), el('div', { className: 'grow' },
    el('h1', { text: festival.name }),
    el('div', { className: 'sub', text: festival.open ? (festival.theme.subtitle || 'Live-Ranking') : 'Das Fest ist beendet – Endstand' })));

  const known = me.teamId && state.teams.some((team) => team.id === me.teamId);
  const showPicker = festival.open && (picking || !known);
  fill(body, 
    !festival.open && el('div', { className: 'banner closed', text: 'Das Fest ist beendet. Danke fürs Mitmachen! 🍻' }),
    ownerBanner(),
    showPicker ? pickView() : myTeamCard(),
    el('section', { className: 'stack-sm' },
      el('h2', { text: festival.open ? 'Ranking' : 'Endstand' }),
      state.teams.length ? rankingList : el('p', { className: 'muted', text: 'Noch keine Teams.' })),
  );
  renderRanking();
}

async function load() {
  const data = await api(`/api/p/${publicId}/state`);
  ({ me, canCreateTeam } = data);
  state = data;
  render();
}

const reloadSoon = debounce(() => load().catch(() => {}), 300);

async function acceptInvite() {
  if (!invitedTeamId || !state.festival.open) return;
  const team = state.teams.find((row) => row.id === invitedTeamId);
  if (!team || me.teamId === team.id) return;
  if (!me.teamId) {
    await choose(team.id);
    toast(`Willkommen bei Team „${team.name}“ 🍻`, { type: 'success' });
    return;
  }
  toast(`Du bist eingeladen zu „${team.name}“`, { action: 'Wechseln', timeout: 10_000, onAction: () => choose(team.id) });
}

try {
  await load();
  await acceptInvite();
  connectLive(publicId, {
    onState: (next) => {
      state = { ...state, ...next };
      const missingOwned = me.ownedTeamIds.some((id) => !next.teams.some((team) => team.id === id));
      if ((me.teamId && !next.teams.some((team) => team.id === me.teamId)) || missingOwned || canCreateTeam !== (next.festival.open && next.festival.theme.guestTeams)) {
        reloadSoon();
      }
      const input = document.activeElement;
      if (input?.matches('input') && body.contains(input)) return;
      render();
    },
    onRefresh: load,
    onDeleted: () => location.reload(),
  });
} catch (err) {
  showError(err);
}
