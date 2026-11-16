import {
  $, el, fill, api, applyTheme, iconNode, connectLive, toast, showError, showQr, modal, confirmDialog,
  copyText, fmtTime, fmtDateTime, fmtNum, fmtRemaining, imageToDataUrl, TEAM_COLORS, PRESETS, debounce, auditTable,
} from '/common.js';

const token = location.pathname.split('/')[2];
const base = `/api/m/${token}`;
const app = $('#app');
let state;
let tab = sessionStorage.getItem('dt-tab') || 'start';
const filters = {
  device: '', team: '', drink: '', from: '', to: '',
};
let entries = [];
let auditRows = [];
let designDraft = null;

const TABS = [
  ['start', 'Start'],
  ['teams', 'Teams'],
  ['drinks', 'Getränke'],
  ['design', 'Design'],
  ['log', 'Protokoll'],
  ['audit', 'Audit'],
  ['export', 'Export'],
];

async function call(path, method, body, success) {
  try {
    const result = await api(`${base}${path}`, method, body);
    if (success) toast(success, { type: 'success' });
    await load();
    return result;
  } catch (err) {
    showError(err);
    return null;
  }
}

async function load() {
  state = await api(`${base}/state`);
  if (tab === 'log') await loadEntries();
  if (tab === 'audit') await loadAudit();
  render();
}

async function loadEntries() {
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, k === 'from' || k === 'to' ? new Date(v).toISOString() : v]));
  ({ entries } = await api(`${base}/entries?${query}`));
}

async function loadAudit() {
  ({ audit: auditRows } = await api(`${base}/audit`));
}

function auditTab() {
  return el('div', { className: 'stack' },
    el('p', { className: 'muted', text: 'Alle Aktionen bei diesem Fest: wer wann was gemacht hat – Buchungen, Stornos, Teams, Kassen und Einstellungen. Neueste zuerst.' }),
    auditTable(auditRows));
}

const reload = debounce(() => load().catch(showError), 400);

// ---------- start ----------

function linkRow(label, url, extra) {
  return el('div', { className: 'stack-sm' },
    el('span', { className: 'muted small', text: label }),
    el('div', { className: 'link-box' },
      el('code', { text: url }),
      el('button', { type: 'button', className: 'btn small secondary', text: 'Kopieren', onClick: () => copyText(url) }),
      extra));
}

function startTab() {
  const { links, stats, festival, devices, deviceDrinks } = state;
  const perDevice = new Map();
  for (const row of deviceDrinks) {
    const key = row.device_id ?? 'none';
    if (!perDevice.has(key)) perDevice.set(key, []);
    perDevice.get(key).push(row);
  }
  return el('div', { className: 'stack' },
    el('div', { className: 'grid-3' },
      el('div', { className: 'stat' }, el('b', { text: fmtNum(stats.totalDrinks) }), el('span', { text: 'Getränke' })),
      el('div', { className: 'stat' }, el('b', { text: fmtNum(stats.totalPoints) }), el('span', { text: 'Punkte' })),
      el('div', { className: 'stat' }, el('b', { text: fmtNum(stats.teamCount) }), el('span', { text: 'Teams' })),
      el('div', { className: 'stat' }, el('b', { text: fmtNum(stats.lastHour) }), el('span', { text: 'letzte Stunde' }))),
    el('div', { className: 'grid-2' },
      el('a', { className: 'btn primary big', href: links.screenUrl, target: '_blank', rel: 'noopener', text: '📺 Public Screen starten' }),
      el('button', {
        type: 'button',
        className: 'btn accent big',
        text: '🧾 Kassen-QR anzeigen',
        onClick: () => showQr('Kasse verbinden', links.counterUrl, 'Mit diesem Code können Handys und Tablets Getränke buchen. Nur an das Kassenpersonal weitergeben!'),
      }),
      el('button', {
        type: 'button',
        className: 'btn big',
        text: '📱 Gäste-QR anzeigen',
        onClick: () => showQr('Für Gäste', links.publicUrl, 'Gäste wählen hier ihr Team und sehen ihren Platz.'),
      }),
      festival.open && el('label', { className: 'switch card' },
        el('input', {
          type: 'checkbox',
          checked: festival.theme.showPublicQr,
          onChange: (event) => call('/festival', 'PATCH', { theme: { showPublicQr: event.target.checked } }, event.target.checked ? 'Gäste-QR wird angezeigt' : 'Gäste-QR ausgeblendet'),
        }),
        el('span', { text: 'Gäste-QR auf dem Public Screen anzeigen' })),
      festival.open && guestTeamsSwitch()),
    stats.recent.length > 0 && el('div', { className: 'card stack' },
      el('h2', { text: 'Zuletzt gebucht' }),
      el('ul', { className: 'recent' }, stats.recent.map((entry) => el('li', {},
        el('span', { text: entry.drink_emoji || '🥤' }),
        el('span', { className: 'grow' }, `${entry.qty}× ${entry.drink} · `, el('b', { text: entry.team })),
        el('span', { className: 'muted small', text: fmtTime(entry.created_at) }))))),
    el('div', { className: 'card stack' },
      el('h2', { text: 'Links' }),
      el('div', { className: 'banner warn small', text: 'Die Verwaltungs- und Kassen-Links sind geheim. Wer sie hat, kann das Fest verwalten bzw. buchen.' }),
      linkRow('Verwaltung (geheim)', links.manageUrl),
      linkRow('Kasse (privat)', links.counterUrl, festival.open && el('button', {
        type: 'button',
        className: 'btn small secondary',
        text: 'Erneuern',
        onClick: async () => {
          if (!(await confirmDialog('Kassen-Link erneuern?', 'Alle verbundenen Kassen verlieren den Zugang und müssen den neuen QR-Code scannen.', 'Erneuern', true))) return;
          const result = await call('/counter-token', 'POST', {}, 'Neuer Kassen-Link erstellt');
          if (result) showQr('Neuer Kassen-Link', result.counterUrl);
        },
      })),
      linkRow('Gäste (öffentlich)', links.publicUrl),
      linkRow('Public Screen (enthält den Verwaltungs-Link)', links.screenUrl)),
    el('div', { className: 'card stack' },
      el('h2', { text: 'Kassen' }),
      devices.length ? el('ul', { className: 'list' }, devices.map((device) => el('li', { className: 'item' },
        el('div', { className: 'title', text: `🧾 ${device.name}` }),
        el('div', { className: 'meta', text: `${fmtNum(device.drinks)} Getränke · zuletzt aktiv ${fmtTime(device.last_seen_at)}` }),
        el('div', { className: 'meta grow', text: (perDevice.get(device.id) ?? []).map((row) => `${row.emoji} ${row.count}`).join('  ') }))))
        : el('p', { className: 'muted', text: 'Noch keine Kasse verbunden. Zeig den Kassen-QR auf einem Handy oder Tablet.' })),
    el('div', { className: 'card stack' },
      el('h2', { text: 'Laufzeit' }),
      el('p', {}, festival.open
        ? `Das Fest läuft noch ${fmtRemaining(festival.expiresAt)} (bis ${fmtDateTime(festival.expiresAt)}).`
        : `Beendet am ${fmtDateTime(festival.closedAt ?? festival.expiresAt)}. Die Daten werden 7 Tage nach der letzten Aktivität gelöscht.`),
      festival.open && el('button', {
        type: 'button',
        className: 'btn danger',
        text: 'Fest jetzt beenden',
        onClick: async () => {
          if (!(await confirmDialog('Fest beenden?', 'Danach sind keine Buchungen und Änderungen mehr möglich. Der Screen zeigt das Siegerpodest. Das kann nicht rückgängig gemacht werden.', 'Beenden', true))) return;
          call('/close', 'POST', {}, 'Fest beendet');
        },
      })));
}

// ---------- teams ----------

function colorPicker(current, onPick) {
  const box = el('div', { className: 'color-picker' });
  const draw = (value) => fill(box, ...TEAM_COLORS.map((c) => el('button', {
    type: 'button',
    'aria-label': `Farbe ${c}`,
    'aria-pressed': String(c === value),
    style: { background: c },
    onClick: () => {
      draw(c);
      onPick(c);
    },
  })));
  draw(current);
  return box;
}

async function teamOwnerQr(team, rotate = false) {
  const result = rotate
    ? await call(`/teams/${team.id}/owner-token`, 'POST', {}, 'Owner-Link erneuert')
    : await api(`${base}/teams/${team.id}/owner-link`).catch((err) => showError(err));
  if (result) showQr(`Owner-Zugang: ${team.name}`, result.url, 'Wer diesen Code scannt, darf den Teamnamen ändern.');
}

function editTeam(team) {
  let color = team.color;
  const name = el('input', { type: 'text', value: team.name, maxLength: 40, required: true });
  const others = state.allTeams.filter((other) => other.id !== team.id);
  const mergeSelect = el('select', {}, el('option', { value: '', text: 'Team wählen …' }), others.map((other) => el('option', { value: other.id, text: other.name })));
  const close = modal(`Team: ${team.name}`, el('div', { className: 'stack' },
    el('label', { className: 'field' }, el('span', { text: 'Name' }), name),
    el('div', { className: 'field' }, el('span', { text: 'Farbe' }), colorPicker(color, (c) => { color = c; })),
    el('button', {
      type: 'button',
      className: 'btn primary',
      text: 'Speichern',
      onClick: async () => {
        if (await call(`/teams/${team.id}`, 'PATCH', { name: name.value, color }, 'Gespeichert')) close();
      },
    }),
    el('hr'),
    el('div', { className: 'row' },
      el('button', { type: 'button', className: 'btn small secondary', text: 'Owner-QR', onClick: () => teamOwnerQr(team) }),
      el('button', {
        type: 'button',
        className: 'btn small secondary',
        text: 'Owner-Link erneuern',
        onClick: async () => {
          if (await confirmDialog('Owner-Link erneuern?', 'Bisherige Team-Owner verlieren das Recht, den Namen zu ändern.', 'Erneuern', true)) teamOwnerQr(team, true);
        },
      }),
      el('button', {
        type: 'button',
        className: 'btn small secondary',
        text: team.hidden ? 'Wieder anzeigen' : 'Ausblenden',
        onClick: async () => {
          if (await call(`/teams/${team.id}`, 'PATCH', { hidden: !team.hidden }, team.hidden ? 'Team wird angezeigt' : 'Team ausgeblendet')) close();
        },
      })),
    others.length > 0 && el('div', { className: 'field' },
      el('span', { text: `Zusammenführen: alle Buchungen von „${team.name}“ auf ein anderes Team übertragen und dieses löschen` }),
      el('div', { className: 'row' }, el('div', { className: 'grow' }, mergeSelect), el('button', {
        type: 'button',
        className: 'btn secondary',
        text: 'Zusammenführen',
        onClick: async () => {
          if (!mergeSelect.value) return;
          const target = others.find((other) => other.id === mergeSelect.value);
          if (!(await confirmDialog('Teams zusammenführen?', `„${team.name}“ wird in „${target.name}“ zusammengeführt und gelöscht.`, 'Zusammenführen', true))) return;
          if (await call(`/teams/${team.id}/merge`, 'POST', { into: target.id }, 'Zusammengeführt')) close();
        },
      }))),
    team.entries === 0 && el('button', {
      type: 'button',
      className: 'btn danger',
      text: 'Team löschen',
      onClick: async () => {
        if (!(await confirmDialog('Team löschen?', `„${team.name}“ wird endgültig gelöscht.`, 'Löschen', true))) return;
        if (await call(`/teams/${team.id}`, 'DELETE', undefined, 'Team gelöscht')) close();
      },
    })), { wide: true });
}

function guestTeamsSwitch() {
  return el('label', { className: 'switch card' },
    el('input', {
      type: 'checkbox',
      checked: state.festival.theme.guestTeams,
      onChange: (event) => call('/festival', 'PATCH', { theme: { guestTeams: event.target.checked } }, event.target.checked ? 'Gäste dürfen Teams gründen' : 'Gäste können nur noch Teams auswählen'),
    }),
    el('span', {}, 'Gäste dürfen eigene Teams gründen', el('br'),
      el('span', { className: 'muted small', text: 'Aus: Gäste wählen nur ein bestehendes Team. Kassen und Veranstalter können weiterhin Teams anlegen.' })));
}

function teamsTab() {
  const open = state.festival.open;
  let color = TEAM_COLORS[state.allTeams.length % TEAM_COLORS.length];
  const name = el('input', { type: 'text', maxLength: 40, required: true, placeholder: 'Teamname', autocomplete: 'off' });
  const ranks = new Map(state.teams.map((team) => [team.id, team.rank]));
  const origin = { owner: 'Veranstalter', counter: 'Kasse', guest: 'Gast' };
  return el('div', { className: 'stack' },
    open && el('form', {
      className: 'card stack',
      onSubmit: async (event) => {
        event.preventDefault();
        if (await call('/teams', 'POST', { name: name.value, color }, 'Team angelegt')) name.value = '';
      },
    },
    el('h2', { text: 'Team hinzufügen' }),
    el('div', { className: 'row' }, el('div', { className: 'grow' }, name), el('button', { type: 'submit', className: 'btn primary', text: 'Hinzufügen' })),
    colorPicker(color, (c) => { color = c; })),
    open && guestTeamsSwitch(),
    el('ul', { className: 'list' }, state.allTeams.map((team) => el('li', { className: `item${team.hidden ? ' is-hidden' : ''}` },
      el('i', { className: 'rank-swatch', style: { '--team': team.color } }),
      el('div', { className: 'title' }, team.name, team.hidden && el('span', { className: 'muted', text: ' (ausgeblendet)' })),
      el('div', { className: 'meta', text: `${ranks.has(team.id) ? `#${ranks.get(team.id)} · ` : ''}${fmtNum(team.drinks)} Getränke · ${fmtNum(team.points)} Pkt · ${origin[team.created_by] ?? ''}` }),
      el('div', { className: 'actions' },
        el('button', { type: 'button', className: 'btn small secondary', text: 'Owner-QR', onClick: () => teamOwnerQr(team) }),
        open && el('button', { type: 'button', className: 'btn small secondary', text: 'Bearbeiten', onClick: () => editTeam(team) }))))),
    !state.allTeams.length && el('p', { className: 'muted', text: 'Noch keine Teams.' }));
}

// ---------- drinks ----------

function drinksTab() {
  const open = state.festival.open;
  const emoji = el('input', { type: 'text', maxLength: 8, placeholder: '🍺', autocomplete: 'off' });
  const name = el('input', { type: 'text', maxLength: 30, required: true, placeholder: 'Getränk', autocomplete: 'off' });
  const points = el('input', { type: 'number', min: 0, max: 100, value: 1, required: true, inputMode: 'numeric' });
  return el('div', { className: 'stack' },
    el('p', { className: 'muted', text: 'Punkte bestimmen das Ranking. Änderungen gelten nur für neue Buchungen.' }),
    open && el('form', {
      className: 'card stack',
      onSubmit: async (event) => {
        event.preventDefault();
        if (await call('/drinks', 'POST', { emoji: emoji.value, name: name.value, points: Number(points.value) }, 'Getränk angelegt')) {
          emoji.value = '';
          name.value = '';
          points.value = 1;
        }
      },
    },
    el('h2', { text: 'Getränkeart hinzufügen' }),
    el('div', { className: 'row' },
      el('label', { className: 'field', style: { width: '80px' } }, el('span', { text: 'Symbol' }), emoji),
      el('label', { className: 'field grow' }, el('span', { text: 'Name' }), name),
      el('label', { className: 'field', style: { width: '90px' } }, el('span', { text: 'Punkte' }), points)),
    el('button', { type: 'submit', className: 'btn primary', text: 'Hinzufügen' })),
    el('ul', { className: 'list' }, state.allDrinks.map((drink) => el('li', { className: `item${drink.hidden ? ' is-hidden' : ''}` },
      el('span', { className: 'fest-emoji', style: { 'font-size': '28px' }, text: drink.emoji || '🥤' }),
      el('div', { className: 'title' }, drink.name, drink.hidden && el('span', { className: 'muted', text: ' (ausgeblendet)' })),
      el('div', { className: 'meta', text: `${drink.points} Pkt · ${fmtNum(drink.drinks)} gebucht` }),
      open && el('div', { className: 'actions' },
        el('button', {
          type: 'button',
          className: 'btn small secondary',
          text: 'Bearbeiten',
          onClick: () => editDrink(drink),
        }),
        el('button', {
          type: 'button',
          className: 'btn small secondary',
          text: drink.hidden ? 'Anzeigen' : 'Ausblenden',
          onClick: () => call(`/drinks/${drink.id}`, 'PATCH', { hidden: !drink.hidden }),
        }),
        drink.drinks === 0 && el('button', {
          type: 'button',
          className: 'btn small danger',
          text: 'Löschen',
          onClick: async () => {
            if (await confirmDialog('Getränk löschen?', `„${drink.name}“ wird gelöscht.`, 'Löschen', true)) call(`/drinks/${drink.id}`, 'DELETE', undefined, 'Gelöscht');
          },
        }))))));
}

function editDrink(drink) {
  const emoji = el('input', { type: 'text', maxLength: 8, value: drink.emoji });
  const name = el('input', { type: 'text', maxLength: 30, value: drink.name, required: true });
  const points = el('input', { type: 'number', min: 0, max: 100, value: drink.points, inputMode: 'numeric' });
  const close = modal(`Getränk: ${drink.name}`, el('form', {
    className: 'stack',
    onSubmit: async (event) => {
      event.preventDefault();
      if (await call(`/drinks/${drink.id}`, 'PATCH', { emoji: emoji.value, name: name.value, points: Number(points.value) }, 'Gespeichert')) close();
    },
  },
  el('label', { className: 'field' }, el('span', { text: 'Symbol' }), emoji),
  el('label', { className: 'field' }, el('span', { text: 'Name' }), name),
  el('label', { className: 'field' }, el('span', { text: 'Punkte pro Stück' }), points),
  el('button', { type: 'submit', className: 'btn primary', text: 'Speichern' })));
}

// ---------- design ----------

function designTab() {
  const { festival } = state;
  designDraft ??= { name: festival.name, ...festival.theme };
  const draft = designDraft;
  const preview = el('div', { className: 'preview' });

  const drawPreview = () => {
    applyTheme({ ...festival, name: draft.name, theme: draft }, preview, { title: false });
    const sample = state.teams.slice(0, 3).length ? state.teams.slice(0, 3) : [
      { id: 'a', name: 'Team Blaulicht', color: TEAM_COLORS[0], points: 12, rank: 1 },
      { id: 'b', name: 'Die Durstigen', color: TEAM_COLORS[1], points: 8, rank: 2 },
      { id: 'c', name: 'Hütchenspieler', color: TEAM_COLORS[2], points: 5, rank: 3 },
    ];
    const max = sample[0].points || 1;
    fill(preview, 
      el('div', { className: 'row' }, iconNode(festival), el('div', {}, el('b', { text: draft.name }), draft.subtitle && el('div', { className: 'muted small', text: draft.subtitle }))),
      el('ol', { className: 'ranking', style: { 'margin-top': '12px' } }, sample.map((team) => el('li', {
        className: `rank-row medal-${team.rank}`,
        style: { '--team': team.color, '--w': `${(team.points / max) * 100}%` },
      },
      el('div', { className: 'rank-no', text: team.rank }),
      el('div', { className: 'rank-name' }, el('span', { text: `${team.name} ${draft.barIcon}` })),
      el('div', { className: 'rank-value', text: team.points }),
      el('div', { className: 'rank-bar' }, el('i'))))),
      el('div', { className: 'row', style: { 'margin-top': '12px' } },
        el('span', { className: 'btn small primary', text: 'Primärfarbe' }),
        el('span', { className: 'btn small accent', text: 'Akzentfarbe' })),
    );
  };

  const input = (key, props) => el('input', {
    ...props,
    value: draft[key],
    onInput: (event) => {
      draft[key] = event.target.value;
      drawPreview();
    },
  });

  const presetSelect = el('select', {
    onChange: (event) => {
      draft.preset = event.target.value;
      drawPreview();
    },
  }, PRESETS.map(([value, label]) => el('option', { value, text: label, selected: draft.preset === value })));

  const iconFile = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  const iconEmoji = el('input', { type: 'text', maxLength: 8, placeholder: 'Emoji', value: festival.iconEmoji ?? '' });
  iconFile.addEventListener('change', async () => {
    const [file] = iconFile.files;
    if (!file) return;
    try {
      const iconImage = await imageToDataUrl(file);
      await call('/icon', 'PUT', { iconImage }, 'Icon gespeichert');
    } catch (err) {
      showError(err);
    }
  });

  const open = festival.open;
  drawPreview();
  return el('div', { className: 'grid-2' },
    el('div', { className: 'stack' },
      el('form', {
        className: 'card stack',
        onSubmit: async (event) => {
          event.preventDefault();
          const { name, ...theme } = draft;
          if (await call('/festival', 'PATCH', {
            name,
            theme: {
              preset: theme.preset, primary: theme.primary, accent: theme.accent, subtitle: theme.subtitle, barIcon: theme.barIcon,
            },
          }, 'Design gespeichert')) designDraft = null;
        },
      },
      el('h2', { text: 'Name & Design' }),
      el('label', { className: 'field' }, el('span', { text: 'Name des Fests' }), input('name', { type: 'text', maxLength: 80, required: true })),
      el('label', { className: 'field' }, el('span', { text: 'Untertitel' }), input('subtitle', { type: 'text', maxLength: 120, placeholder: 'z. B. Hütchencounter' })),
      el('label', { className: 'field' }, el('span', { text: 'Hintergrund' }), presetSelect),
      el('div', { className: 'row' },
        el('label', { className: 'field' }, el('span', { text: 'Primär' }), input('primary', { type: 'color' })),
        el('label', { className: 'field' }, el('span', { text: 'Akzent' }), input('accent', { type: 'color' })),
        el('label', { className: 'field grow' }, el('span', { text: 'Balken-Symbol' }), input('barIcon', { type: 'text', maxLength: 8 }))),
      open && el('button', { type: 'submit', className: 'btn primary', text: 'Speichern' })),
      el('div', { className: 'card stack' },
        el('h2', { text: 'Icon' }),
        el('div', { className: 'row' },
          iconNode(festival),
          el('div', { className: 'grow' }, iconEmoji),
          open && el('button', {
            type: 'button',
            className: 'btn secondary',
            text: 'Emoji setzen',
            onClick: () => call('/icon', 'PUT', { iconEmoji: iconEmoji.value }, 'Icon gespeichert'),
          })),
        open && el('div', { className: 'row' },
          el('button', { type: 'button', className: 'btn secondary', text: 'Bild hochladen', onClick: () => iconFile.click() }),
          festival.iconUrl && el('button', {
            type: 'button',
            className: 'btn secondary',
            text: 'Bild entfernen',
            onClick: () => call('/icon', 'PUT', { iconEmoji: festival.iconEmoji ?? '' }, 'Bild entfernt'),
          }),
          iconFile),
        el('p', { className: 'muted small', text: 'Das Icon erscheint auf dem Screen, bei Gästen, an der Kasse und als Favicon.' }))),
    el('div', { className: 'stack' }, el('h2', { text: 'Vorschau' }), preview));
}

// ---------- log ----------

function logTab() {
  const select = (key, label, options) => el('label', { className: 'field' }, el('span', { text: label }), el('select', {
    onChange: async (event) => {
      filters[key] = event.target.value;
      await loadEntries().catch(showError);
      render();
    },
  }, el('option', { value: '', text: 'Alle' }), options.map(([value, text]) => el('option', { value, text, selected: filters[key] === value }))));
  const dateInput = (key, label) => el('label', { className: 'field' }, el('span', { text: label }), el('input', {
    type: 'datetime-local',
    value: filters[key],
    onChange: async (event) => {
      filters[key] = event.target.value;
      await loadEntries().catch(showError);
      render();
    },
  }));
  const open = state.festival.open;
  return el('div', { className: 'stack' },
    el('div', { className: 'card grid-3' },
      select('device', 'Kasse', state.devices.map((d) => [d.id, d.name])),
      select('team', 'Team', state.allTeams.map((t) => [t.id, t.name])),
      select('drink', 'Getränk', state.allDrinks.map((d) => [d.id, `${d.emoji} ${d.name}`])),
      dateInput('from', 'Von'),
      dateInput('to', 'Bis')),
    el('p', { className: 'muted small', text: `${entries.length}${entries.length === 1000 ? '+' : ''} Buchungen · neueste zuerst` }),
    el('table', { className: 'log' },
      el('thead', {}, el('tr', {}, ['Zeit', 'Kasse', 'Team', 'Getränk', 'Menge', 'Punkte', ''].map((h) => el('th', { text: h })))),
      el('tbody', {}, entries.map((entry) => el('tr', { className: entry.undone_at ? 'undone' : '' },
        el('td', { dataset: { label: 'Zeit' }, text: fmtDateTime(entry.created_at) }),
        el('td', { dataset: { label: 'Kasse' }, text: entry.device ?? '–' }),
        el('td', { dataset: { label: 'Team' }, text: entry.team }),
        el('td', { dataset: { label: 'Getränk' }, text: `${entry.drink_emoji} ${entry.drink}` }),
        el('td', { dataset: { label: 'Menge' }, text: entry.qty }),
        el('td', { dataset: { label: 'Punkte' }, text: entry.points }),
        el('td', {}, entry.undone_at
          ? el('span', { className: 'muted small', text: `storniert ${fmtTime(entry.undone_at)}${entry.undone_by ? ` (${entry.undone_by})` : ''}` })
          : open && el('button', {
            type: 'button',
            className: 'btn small secondary',
            text: 'Stornieren',
            onClick: async () => {
              if (!(await confirmDialog('Buchung stornieren?', `${entry.qty}× ${entry.drink} für ${entry.team} (${fmtDateTime(entry.created_at)})`, 'Stornieren', true))) return;
              call(`/entries/${entry.id}/undo`, 'POST', {}, 'Storniert');
            },
          })))))));
}

// ---------- export ----------

function exportTab() {
  return el('div', { className: 'grid-2' },
    el('div', { className: 'card stack' },
      el('h2', { text: 'PDF-Bericht' }),
      el('p', { className: 'muted', text: 'Endstand, Summen je Team, Getränk und Kasse sowie das vollständige Buchungsprotokoll. Im Druckdialog „Als PDF sichern“ wählen.' }),
      el('a', { className: 'btn primary', href: state.links.reportUrl, target: '_blank', rel: 'noopener', text: 'Bericht öffnen' })),
    el('div', { className: 'card stack' },
      el('h2', { text: 'CSV' }),
      el('p', { className: 'muted', text: 'Alle Buchungen als Tabelle (z. B. für Excel).' }),
      el('a', { className: 'btn secondary', href: `${base}/entries.csv`, download: 'drinktracker-buchungen.csv', text: 'CSV herunterladen' })));
}

// ---------- shell ----------

const VIEWS = {
  start: startTab, teams: teamsTab, drinks: drinksTab, design: designTab, log: logTab, audit: auditTab, export: exportTab,
};

function render() {
  if (!state) return;
  const active = document.activeElement;
  if (active && app.contains(active) && active.matches('input[type="text"], input[type="number"], input[type="color"]')) return;
  const { festival } = state;
  applyTheme(festival);
  fill(app, 
    el('header', { className: 'topbar' },
      iconNode(festival),
      el('div', { className: 'grow' },
        el('h1', { text: festival.name }),
        el('div', { className: 'sub', text: festival.open ? `Verwaltung · läuft noch ${fmtRemaining(festival.expiresAt)}` : 'Verwaltung · beendet' }))),
    el('main', { className: 'page stack' },
      el('nav', { className: 'tabs', role: 'tablist' }, TABS.map(([key, label]) => el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(tab === key),
        text: label,
        onClick: async () => {
          tab = key;
          sessionStorage.setItem('dt-tab', key);
          if (key === 'log') await loadEntries().catch(showError);
          if (key === 'audit') await loadAudit().catch(showError);
          render();
        },
      }))),
      !festival.open && el('div', { className: 'banner closed', text: 'Das Fest ist beendet. Du kannst alles ansehen und exportieren, aber nichts mehr ändern.' }),
      VIEWS[tab]?.() ?? startTab()),
  );
}

try {
  await load();
  connectLive(state.festival.publicId, {
    onState: () => reload(),
    onRefresh: load,
    onDeleted: () => location.reload(),
    role: 'manage',
  });
} catch (err) {
  showError(err);
}
