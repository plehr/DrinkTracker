import {
  $, el, fill, api, applyTheme, iconNode, connectLive, toast, showError, showQr, modal, promptDialog, fmtTime, fmtNum,
  TEAM_COLORS, debounce,
} from '/common.js';

const token = location.pathname.split('/')[2];
const base = `/api/t/${token}`;
const app = $('#app');
let state;
let qty = 1;
let search = '';
let sort = 'name';
let closeSheet = null;

async function load() {
  state = await api(`${base}/state`);
  render();
  return state;
}

const reload = debounce(() => load().catch(showError), 250);

function registerView() {
  const name = el('input', {
    type: 'text', maxLength: 30, required: true, placeholder: 'z. B. Kasse 1, Kasse Bier', autocomplete: 'off', value: state.device?.name ?? '',
  });
  const submit = el('button', { type: 'submit', className: 'btn primary big block', text: 'Kasse starten' });
  return el('main', { className: 'page page-narrow stack' },
    el('div', { className: 'hero' },
      iconNode(state.festival, 'fest-icon'),
      el('h1', { text: state.festival.name }),
      el('p', { text: 'Gib diesem Gerät einen Namen. Er erscheint im Buchungsprotokoll des Veranstalters.' })),
    el('form', {
      className: 'card stack',
      onSubmit: async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
          await api(`${base}/device`, 'POST', { name: name.value });
          await load();
        } catch (err) {
          showError(err);
          submit.disabled = false;
        }
      },
    }, el('label', { className: 'field' }, el('span', { text: 'Name der Kasse' }), name), submit));
}

async function book(team, drink) {
  const amount = qty;
  try {
    const entry = await api(`${base}/entries`, 'POST', { teamId: team.id, drinkTypeId: drink.id, qty: amount });
    closeSheet?.();
    qty = 1;
    toast(`${amount}× ${drink.emoji} ${drink.name} für ${team.name}`, {
      type: 'success',
      action: 'Rückgängig',
      timeout: 10_000,
      onAction: () => undo(entry.id),
    });
    navigator.vibrate?.(30);
    reload();
  } catch (err) {
    showError(err);
  }
}

async function undo(id) {
  try {
    await api(`${base}/entries/${id}/undo`, 'POST', {});
    toast('Buchung zurückgenommen');
    reload();
  } catch (err) {
    showError(err);
  }
}

async function renameTeam(team) {
  const name = await promptDialog('Team umbenennen', 'Neuer Teamname', team.name);
  if (!name || name === team.name) return;
  try {
    await api(`${base}/teams/${team.id}`, 'PATCH', { name });
    closeSheet?.();
    reload();
  } catch (err) {
    showError(err);
  }
}

async function ownerQr(team) {
  try {
    const { url } = await api(`${base}/teams/${team.id}/owner-link`);
    showQr(`Owner-Zugang: ${team.name}`, url, 'Der Gast scannt diesen Code und kann danach den Teamnamen ändern.');
  } catch (err) {
    showError(err);
  }
}

async function newTeam() {
  const name = await promptDialog('Neues Team', 'Teamname');
  if (!name) return;
  try {
    const color = TEAM_COLORS[state.teams.length % TEAM_COLORS.length];
    await api(`${base}/teams`, 'POST', { name, color });
    toast(`Team „${name}“ angelegt`, { type: 'success' });
    await load();
  } catch (err) {
    showError(err);
  }
}

function openTeam(team) {
  const qtyLabel = el('p', { className: 'muted', text: qty > 1 ? `Menge: ${qty}×` : 'Menge: 1×' });
  closeSheet = modal(team.name, el('div', { className: 'stack' },
    qtyLabel,
    el('div', { className: 'drink-grid' }, state.drinks.map((drink) => el('button', {
      type: 'button',
      className: 'drink-btn',
      onClick: () => book(team, drink),
    },
    el('span', { className: 'e', text: drink.emoji || '🥤' }),
    el('span', { text: drink.name }),
    el('small', { text: `${drink.points} ${drink.points === 1 ? 'Punkt' : 'Punkte'}` })))),
    el('div', { className: 'row' },
      el('button', { type: 'button', className: 'btn small secondary', text: 'Umbenennen', onClick: () => renameTeam(team) }),
      el('button', { type: 'button', className: 'btn small secondary', text: 'Owner-QR', onClick: () => ownerQr(team) }))), {
    wide: true,
    onClose: () => { closeSheet = null; },
  });
}

function qtyControl() {
  const output = el('output', { text: qty });
  const set = (value) => {
    qty = Math.min(50, Math.max(1, value));
    output.textContent = qty;
  };
  return el('div', { className: 'qty', role: 'group', 'aria-label': 'Menge' },
    el('button', { type: 'button', 'aria-label': 'Weniger', text: '−', onClick: () => set(qty - 1) }),
    output,
    el('button', { type: 'button', 'aria-label': 'Mehr', text: '+', onClick: () => set(qty + 1) }),
    el('button', { type: 'button', 'aria-label': 'Plus fünf', text: '+5', onClick: () => set(qty + 5) }));
}

const tiles = el('div', { className: 'tiles' });

function renderTiles() {
  const term = search.toLowerCase();
  const teams = [...state.teams]
    .filter((team) => team.name.toLowerCase().includes(term))
    .sort(sort === 'rank' ? (a, b) => a.rank - b.rank : (a, b) => a.name.localeCompare(b.name, 'de'));
  fill(tiles, ...teams.map((team) => el('button', {
    type: 'button',
    className: 'tile',
    style: { '--team': team.color },
    disabled: !state.festival.open,
    onClick: () => openTeam(team),
  },
  el('b', { text: team.name }),
  el('small', { text: `#${team.rank} · ${fmtNum(team.drinks)} Getränke` }))));
  if (!teams.length) {
    tiles.append(el('p', { className: 'muted', text: state.teams.length ? 'Kein Team gefunden.' : 'Noch keine Teams. Lege das erste an oder lass Gäste ihr Team über den Gäste-QR gründen.' }));
  }
}

let mainView;

function render() {
  if (!state) return;
  applyTheme(state.festival);
  if (!state.device) {
    fill(app, registerView());
    mainView = null;
    return;
  }
  const active = document.activeElement;
  if (mainView && active?.matches('input[type="search"]')) {
    renderTiles();
    renderRecent();
    return;
  }
  const searchInput = el('input', {
    type: 'search', placeholder: 'Team suchen …', value: search, autocomplete: 'off',
    onInput: (event) => {
      search = event.target.value;
      renderTiles();
    },
  });
  const sortSelect = el('select', {
    'aria-label': 'Sortierung',
    onChange: (event) => {
      sort = event.target.value;
      renderTiles();
    },
  }, el('option', { value: 'name', text: 'A–Z', selected: sort === 'name' }), el('option', { value: 'rank', text: 'Rang', selected: sort === 'rank' }));

  mainView = el('div', {},
    el('header', { className: 'topbar' },
      iconNode(state.festival),
      el('div', { className: 'grow' },
        el('h1', { text: state.festival.name }),
        el('button', {
          type: 'button',
          className: 'btn small secondary',
          text: `🧾 ${state.device.name}`,
          title: 'Kassenname ändern',
          onClick: async () => {
            const name = await promptDialog('Kasse umbenennen', 'Name der Kasse', state.device.name, 30);
            if (!name) return;
            try {
              await api(`${base}/device`, 'POST', { name });
              await load();
            } catch (err) {
              showError(err);
            }
          },
        }))),
    el('main', { className: 'page stack' },
      !state.festival.open && el('div', { className: 'banner closed', text: 'Das Fest ist beendet – keine Buchungen mehr möglich.' }),
      el('div', { className: 'counter-bar' },
        qtyControl(),
        el('div', { className: 'grow' }, searchInput),
        el('div', {}, sortSelect),
        state.festival.open && el('button', { type: 'button', className: 'btn accent', text: '+ Team', onClick: newTeam })),
      tiles,
      el('section', { className: 'stack-sm' }, el('h2', { text: 'Letzte Buchungen dieser Kasse' }), recentList)));
  fill(app, mainView);
  renderTiles();
  renderRecent();
}

const recentList = el('ul', { className: 'recent' });

function renderRecent() {
  fill(recentList, ...state.recent.map((entry) => el('li', { className: entry.undone_at ? 'undone' : '' },
    el('span', { text: entry.drink_emoji || '🥤' }),
    el('span', { className: 'grow' }, `${entry.qty}× ${entry.drink} · `, el('b', { text: entry.team })),
    el('span', { className: 'muted small', text: fmtTime(entry.created_at) }),
    entry.undoable && !entry.undone_at && state.festival.open && el('button', {
      type: 'button', className: 'btn small secondary', text: 'Zurück', onClick: () => undo(entry.id),
    }))));
  if (!state.recent.length) recentList.append(el('li', { className: 'muted', text: 'Noch nichts gebucht.' }));
}

try {
  await load();
  connectLive(state.festival.publicId, {
    onState: () => reload(),
    onRefresh: load,
    onDeleted: () => location.reload(),
  });
} catch (err) {
  showError(err);
}
