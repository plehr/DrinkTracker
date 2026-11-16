export const TEAM_COLORS = [
  '#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1',
  '#fdd835', '#d81b60', '#6d4c41', '#3949ab', '#7cb342', '#f4511e',
];

export const PRESETS = [
  ['blaulicht', 'Blaulicht'],
  ['nacht', 'Dunkel'],
  ['hell', 'Hell'],
  ['feuer', 'Feuer'],
];

export const $ = (selector, root = document) => root.querySelector(selector);

// iOS leaves the page shifted up after the keyboard closes when the page is shorter than the screen,
// and it can't be scrolled back. Pull the scroll position back into the valid range.
export function settleViewport() {
  requestAnimationFrame(() => {
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const shifted = (window.visualViewport?.offsetTop ?? 0) > 1 && window.visualViewport.height >= window.innerHeight - 1;
    if (window.scrollY > max + 1 || shifted) window.scrollTo(0, Math.min(window.scrollY, max));
  });
}

document.addEventListener('focusout', () => setTimeout(settleViewport, 50));
new ResizeObserver(settleViewport).observe(document.documentElement);
window.visualViewport?.addEventListener('resize', () => {
  if (window.visualViewport.height >= window.innerHeight - 1) settleViewport();
});

export function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((child) => child != null && child !== false));
  return node;
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') for (const [prop, v] of Object.entries(value)) node.style.setProperty(prop, v);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && typeof node[key] !== 'function' && !key.includes('-')) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export async function api(path, method = 'GET', body) {
  const options = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new Error('Keine Verbindung zum Server');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const err = new Error(data?.error ?? `Fehler ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- formatting ----------

export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (iso) => new Date(iso).toLocaleString('de-DE', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
export const fmtNum = (n) => Number(n).toLocaleString('de-DE');

export function fmtRemaining(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'abgelaufen';
  const hours = Math.floor(ms / 3600_000);
  const minutes = Math.floor((ms % 3600_000) / 60_000);
  return hours >= 24 ? `${Math.floor(hours / 24)} T ${hours % 24} Std` : `${hours} Std ${minutes} Min`;
}

export const pathToken = (index) => location.pathname.split('/')[index];

// ---------- feedback ----------

let toastBox;

export function toast(message, { type = 'info', action, onAction, timeout = 4000 } = {}) {
  toastBox ??= document.body.appendChild(el('div', { className: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const item = el('div', { className: `toast toast-${type}` }, el('span', { text: message }));
  const close = () => item.remove();
  if (action) {
    item.append(el('button', {
      type: 'button',
      className: 'toast-action',
      text: action,
      onClick: () => {
        close();
        onAction();
      },
    }));
  }
  toastBox.append(item);
  setTimeout(close, timeout);
  return close;
}

export const showError = (err) => toast(err.message ?? String(err), { type: 'error', timeout: 6000 });

export function modal(title, content, { wide = false, onClose } = {}) {
  const dialog = el('dialog', { className: `modal${wide ? ' modal-wide' : ''}` });
  const close = () => {
    dialog.close();
    dialog.remove();
    onClose?.();
    settleViewport();
  };
  dialog.append(
    el('div', { className: 'modal-head' },
      el('h2', { text: title }),
      el('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Schließen', text: '✕', onClick: close })),
    el('div', { className: 'modal-body' }, content),
  );
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return close;
}

export async function confirmDialog(title, text, confirmLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      close();
      resolve(value);
    };
    const close = modal(title, el('div', {},
      el('p', { text }),
      el('div', { className: 'row end' },
        el('button', { type: 'button', className: 'btn secondary', text: 'Abbrechen', onClick: () => finish(false) }),
        el('button', { type: 'button', className: `btn ${danger ? 'danger' : 'primary'}`, text: confirmLabel, onClick: () => finish(true) }))),
    { onClose: () => finish(false) });
  });
}

export async function promptDialog(title, label, value = '', maxLength = 40) {
  return new Promise((resolve) => {
    let done = false;
    const input = el('input', { type: 'text', value, maxLength, required: true, autocomplete: 'off' });
    const finish = (result) => {
      if (done) return;
      done = true;
      close();
      resolve(result);
    };
    const form = el('form', {
      className: 'stack',
      onSubmit: (event) => {
        event.preventDefault();
        if (input.value.trim()) finish(input.value.trim());
      },
    },
    el('label', { className: 'field' }, el('span', { text: label }), input),
    el('div', { className: 'row end' },
      el('button', { type: 'button', className: 'btn secondary', text: 'Abbrechen', onClick: () => finish(null) }),
      el('button', { type: 'submit', className: 'btn primary', text: 'Speichern' })));
    const close = modal(title, form, { onClose: () => finish(null) });
    input.focus();
    input.select();
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Kopiert');
  } catch {
    window.prompt('Zum Kopieren:', text);
  }
}

// ---------- QR codes ----------

export function qrElement(url, className = 'qr') {
  const box = el('div', { className });
  if (!window.qrcode) return box;
  const code = window.qrcode(0, 'M');
  code.addData(url);
  code.make();
  box.innerHTML = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  return box;
}

export function showQr(title, url, hint) {
  return modal(title, el('div', { className: 'qr-modal' },
    qrElement(url, 'qr qr-big'),
    hint && el('p', { className: 'muted center', text: hint }),
    el('div', { className: 'link-box' },
      el('code', { text: url }),
      el('button', { type: 'button', className: 'btn small secondary', text: 'Kopieren', onClick: () => copyText(url) }))), { wide: true });
}

// ---------- theme ----------

export function iconNode(festival, className = 'fest-icon') {
  if (festival.iconUrl) return el('img', { className, src: festival.iconUrl, alt: '' });
  if (festival.iconEmoji) return el('span', { className: `${className} fest-emoji`, text: festival.iconEmoji, 'aria-hidden': 'true' });
  return el('img', { className, src: '/favicon.svg', alt: '' });
}

function setFavicon(festival) {
  let href = '/favicon.svg';
  if (festival.iconUrl) href = festival.iconUrl;
  else if (festival.iconEmoji) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${festival.iconEmoji}</text></svg>`;
    href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  let link = document.querySelector('link[rel="icon"]');
  if (!link) link = document.head.appendChild(el('link', { rel: 'icon' }));
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

export function applyTheme(festival, target = document.body, { title = true } = {}) {
  const { theme } = festival;
  target.dataset.preset = theme.preset;
  if (target === document.body) document.documentElement.dataset.preset = theme.preset;
  target.style.setProperty('--primary', theme.primary);
  target.style.setProperty('--accent', theme.accent);
  if (title) {
    document.title = `${festival.name} · DrinkTracker`;
    setFavicon(festival);
  }
}

// ---------- images ----------

export async function imageToDataUrl(file, max = 256) {
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) throw new Error('Bitte ein Bild auswählen');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
      image.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
    const canvas = el('canvas', { width: Math.round((img.naturalWidth || max) * scale), height: Math.round((img.naturalHeight || max) * scale) });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- ranking ----------

export function rankLabel(team, total) {
  return `Platz ${team.rank} von ${total}`;
}

export function gaps(teams, teamId) {
  const index = teams.findIndex((team) => team.id === teamId);
  if (index < 0) return null;
  const me = teams[index];
  const ahead = teams.slice(0, index).reverse().find((team) => team.points > me.points);
  const behind = teams.slice(index + 1).find((team) => team.points < me.points);
  return {
    me,
    ahead: ahead && { team: ahead, diff: ahead.points - me.points },
    behind: behind && { team: behind, diff: me.points - behind.points },
  };
}

// FLIP animation for reordered lists keyed by data-id.
export function animateList(container, render) {
  const before = new Map([...container.children].map((node) => [node.dataset.id, node.getBoundingClientRect().top]));
  render();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const node of container.children) {
    const top = before.get(node.dataset.id);
    if (top === undefined) {
      node.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: 'ease-out' });
      continue;
    }
    const delta = top - node.getBoundingClientRect().top;
    if (Math.abs(delta) > 1) {
      node.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
}

// ---------- live connection ----------

const COOLDOWN_MS = 30_000;
const STALE_MS = 40_000;

export function connectLive(publicId, {
  onState, onRefresh, onDeleted, role = 'guest',
}) {
  const indicator = el('div', { className: 'live-indicator' });
  const dot = el('span', { className: 'live-dot', title: 'Live verbunden', 'aria-label': 'Live verbunden' });
  const button = el('button', {
    type: 'button',
    className: 'live-refresh',
    title: 'Keine Live-Verbindung – jetzt aktualisieren',
    'aria-label': 'Keine Live-Verbindung – jetzt aktualisieren',
    text: '⟳',
  });
  indicator.append(dot, button);
  document.body.append(indicator);

  let ws;
  let connected = false;
  let retry = 1000;
  let retryTimer;
  let staleTimer;
  let cooldownUntil = 0;
  let cooldownTimer;

  const render = () => {
    const coolingDown = Date.now() < cooldownUntil;
    dot.hidden = !connected;
    button.hidden = connected || coolingDown;
  };

  const markAlive = () => {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => ws?.close(), STALE_MS);
  };

  const connect = () => {
    clearTimeout(retryTimer);
    if (ws && ws.readyState <= 1) return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${scheme}://${location.host}/ws?p=${encodeURIComponent(publicId)}&r=${role}`);
    ws.addEventListener('open', () => {
      connected = true;
      retry = 1000;
      markAlive();
      render();
    });
    ws.addEventListener('message', (event) => {
      markAlive();
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'state') onState(message.state);
      if (message.type === 'deleted') onDeleted?.();
    });
    ws.addEventListener('close', () => {
      connected = false;
      clearTimeout(staleTimer);
      render();
      retryTimer = setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30_000);
    });
  };

  button.addEventListener('click', async () => {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    render();
    clearTimeout(cooldownTimer);
    cooldownTimer = setTimeout(render, COOLDOWN_MS + 50);
    retry = 1000;
    connect();
    try {
      await onRefresh();
    } catch (err) {
      showError(err);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !connected) {
      retry = 1000;
      connect();
    }
  });

  render();
  connect();
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------- audit log ----------

const AUDIT_ACTIONS = {
  'festival.created': 'Fest angelegt',
  'festival.updated': 'Fest geändert',
  'festival.icon': 'Icon geändert',
  'festival.closed': 'Fest beendet',
  'festival.expired': 'Fest abgelaufen',
  'festival.deleted': 'Fest gelöscht',
  'team.created': 'Team angelegt',
  'team.updated': 'Team geändert',
  'team.deleted': 'Team gelöscht',
  'team.merged': 'Teams zusammengeführt',
  'team.owner_rotated': 'Owner-Link erneuert',
  'team.owner_claimed': 'Owner-Zugang übernommen',
  'drink.created': 'Getränk angelegt',
  'drink.updated': 'Getränk geändert',
  'drink.deleted': 'Getränk gelöscht',
  'device.registered': 'Kasse registriert',
  'device.renamed': 'Kasse umbenannt',
  'counter.link_rotated': 'Kassen-Link erneuert',
  'entry.booked': 'Getränk gebucht',
  'entry.undone': 'Buchung zurückgenommen',
  'entry.cancelled': 'Buchung storniert',
  'team.joined': 'Team beigetreten',
  'team.left': 'Team verlassen',
  'settings.creation': 'Anlegen neuer Feste',
  'admin.login': 'Admin-Anmeldung',
};

const FIELD_LABELS = {
  name: 'Name', subtitle: 'Untertitel', preset: 'Hintergrund', primary: 'Primärfarbe', accent: 'Akzentfarbe',
  barIcon: 'Balken-Symbol', showPublicQr: 'Gäste-QR', guestTeams: 'Gäste-Teams', color: 'Farbe', hidden: 'ausgeblendet',
  emoji: 'Symbol', points: 'Punkte',
};

const fmtValue = (value) => {
  if (value === true) return 'an';
  if (value === false) return 'aus';
  if (value === '' || value == null) return '–';
  return String(value);
};

export const auditAction = (action) => AUDIT_ACTIONS[action] ?? action;

export function auditDetails(row) {
  const d = row.details ?? {};
  const parts = [];
  if (d.team) parts.push(`Team „${d.team}“`);
  if (d.drink) parts.push(d.drink);
  if (d.device) parts.push(`„${d.device}“`);
  if (d.into) parts.push(`→ „${d.into}“`);
  if (d.qty) parts.push(`${d.qty}×`);
  if (d.entry) parts.push(`Buchung #${d.entry}`);
  if (d.points !== undefined && typeof d.points !== 'object') parts.push(`${d.points} Punkte`);
  if (typeof d.from === 'string') parts.push(`„${d.from}“ → „${d.to}“`);
  if (d.enabled !== undefined) parts.push(d.enabled ? 'erlaubt' : 'gestoppt');
  if (d.emoji !== undefined && typeof d.emoji !== 'object') parts.push(`Emoji ${fmtValue(d.emoji)}${d.image ? ', Bild' : ''}`);
  for (const [key, change] of Object.entries(d)) {
    if (change && typeof change === 'object' && 'from' in change) {
      parts.push(`${FIELD_LABELS[key] ?? key}: ${fmtValue(change.from)} → ${fmtValue(change.to)}`);
    }
  }
  return parts.join(' · ');
}

export function auditTable(rows, { withFestival = false, withIp = false } = {}) {
  if (!rows.length) return el('p', { className: 'muted', text: 'Noch keine Einträge.' });
  const headers = ['Zeit', withFestival && 'Fest', 'Wer', 'Aktion', 'Details', withIp && 'IP'].filter(Boolean);
  return el('div', { className: 'table-wrap' }, el('table', { className: 'log' },
    el('thead', {}, el('tr', {}, headers.map((h) => el('th', { text: h })))),
    el('tbody', {}, rows.map((row) => el('tr', {},
      el('td', { dataset: { label: 'Zeit' }, className: 'nowrap', text: fmtDateTime(row.at) }),
      withFestival && el('td', { dataset: { label: 'Fest' }, text: row.festival ?? '–' }),
      el('td', { dataset: { label: 'Wer' }, text: row.actor_label }),
      el('td', { dataset: { label: 'Aktion' }, text: auditAction(row.action) }),
      el('td', { dataset: { label: 'Details' }, text: auditDetails(row) || '–' }),
      withIp && el('td', { dataset: { label: 'IP' }, className: 'small', text: row.ip ?? '–' }))))));
}
