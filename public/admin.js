import {
  $, el, fill, api, iconNode, showError, toast, confirmDialog, copyText, fmtDateTime, fmtNum, fmtRemaining,
} from '/common.js';

const app = $('#app');
let data;
let settings;
let filter = 'all';

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

function linkButtons(links) {
  return [
    ['Verwaltung', links.manageUrl],
    ['Screen', links.screenUrl],
    ['Kasse', links.counterUrl],
    ['Gäste', links.publicUrl],
  ].map(([label, url]) => el('span', { className: 'row', style: { gap: '4px' } },
    el('a', { className: 'btn small secondary', href: url, target: '_blank', rel: 'noopener', text: label }),
    el('button', { type: 'button', className: 'icon-btn', title: `${label}-Link kopieren`, 'aria-label': `${label}-Link kopieren`, text: '⧉', onClick: () => copyText(url) })));
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
    el('div', { className: 'muted small', text: `${fmtNum(f.teams)} Teams · ${fmtNum(f.devices)} Kassen · ${fmtNum(f.drinks)} Getränke` }),
    el('div', { className: 'row' }, linkButtons(f.links)),
    el('div', { className: 'row end' },
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

function render() {
  const festivals = data.festivals.filter((f) => filter === 'all' || (filter === 'open' ? f.open : !f.open));
  fill(app, 
    el('header', { className: 'topbar' },
      el('img', { className: 'fest-icon', src: '/favicon.svg', alt: '' }),
      el('div', { className: 'grow' }, el('h1', { text: 'DrinkTracker Admin' }), el('div', { className: 'sub', text: `angemeldet als ${data.user}` })),
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
      el('div', { className: 'row between' },
        el('h2', { text: `Feste (${data.festivals.length})` }),
        el('select', {
          'aria-label': 'Filter',
          style: { width: 'auto' },
          onChange: (event) => {
            filter = event.target.value;
            render();
          },
        }, [['all', 'Alle'], ['open', 'Aktiv'], ['closed', 'Beendet']].map(([value, text]) => el('option', { value, text, selected: filter === value })))),
      festivals.length ? el('ul', { className: 'list' }, festivals.map(festivalCard)) : el('p', { className: 'muted', text: 'Keine Feste.' })),
  );
}

load().catch(showError);
setInterval(() => load().catch(() => {}), 60_000);
