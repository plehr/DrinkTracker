import {
  $, el, fill, api, showError, copyText, imageToDataUrl,
} from '/common.js';

const EMOJIS = ['🚒', '🍺', '🎉', '🔥', '🚨', '🍻', '🎪', '🏆', '⛺', '🥳'];

function renderCreated(app, { manageUrl, name }) {
  fill(app, el('main', { className: 'page page-narrow stack' },
    el('div', { className: 'hero' },
      el('img', { src: '/favicon.svg', alt: '' }),
      el('h1', { text: 'Fest gestartet!' }),
      el('p', { text: `„${name}“ läuft jetzt für 3 Tage.` })),
    el('div', { className: 'card stack' },
      el('div', { className: 'banner warn', text: 'Das ist deine geheime Verwaltungs-URL. Speichere sie gut – ohne diesen Link kommst du nicht mehr an dein Fest.' }),
      el('div', { className: 'secret-url', text: manageUrl }),
      el('div', { className: 'row' },
        el('button', { type: 'button', className: 'btn secondary grow', text: 'Link kopieren', onClick: () => copyText(manageUrl) }),
        navigator.share && el('button', {
          type: 'button',
          className: 'btn secondary grow',
          text: 'Teilen',
          onClick: () => navigator.share({ title: name, url: manageUrl }).catch(() => {}),
        })),
      el('a', { className: 'btn primary big block', href: manageUrl, text: 'Zur Verwaltung' }))));
}

function renderForm(app, creationEnabled) {
  let emoji = EMOJIS[0];
  let image = null;

  const name = el('input', {
    type: 'text', name: 'name', maxLength: 80, required: true, placeholder: 'z. B. Blaulichtparty 2026', autocomplete: 'off',
  });
  const picker = el('div', { className: 'emoji-picker', role: 'group', 'aria-label': 'Icon' });
  const custom = el('input', { type: 'text', maxLength: 8, placeholder: 'Eigenes Emoji', autocomplete: 'off' });
  const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  const preview = el('img', { className: 'fest-icon', alt: '', hidden: true });
  const removeImage = el('button', { type: 'button', className: 'btn small secondary', text: 'Bild entfernen', hidden: true });

  const renderPicker = () => {
    fill(picker, ...EMOJIS.map((symbol) => el('button', {
      type: 'button',
      text: symbol,
      'aria-pressed': String(!image && emoji === symbol),
      onClick: () => {
        emoji = symbol;
        custom.value = '';
        renderPicker();
      },
    })));
  };

  custom.addEventListener('input', () => {
    emoji = custom.value.trim() || EMOJIS[0];
    renderPicker();
  });

  file.addEventListener('change', async () => {
    const [chosen] = file.files;
    if (!chosen) return;
    try {
      image = await imageToDataUrl(chosen);
      preview.src = image;
      preview.hidden = false;
      removeImage.hidden = false;
      renderPicker();
    } catch (err) {
      showError(err);
    }
  });

  removeImage.addEventListener('click', () => {
    image = null;
    file.value = '';
    preview.hidden = true;
    removeImage.hidden = true;
    renderPicker();
  });

  const submit = el('button', { type: 'submit', className: 'btn primary big block', text: 'Fest starten' });
  const form = el('form', {
    className: 'card stack',
    onSubmit: async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const result = await api('/api/festivals', 'POST', {
          name: name.value,
          iconEmoji: image ? '' : emoji,
          iconImage: image ?? undefined,
        });
        renderCreated(app, result);
      } catch (err) {
        showError(err);
        submit.disabled = false;
      }
    },
  },
  el('label', { className: 'field' }, el('span', { text: 'Name des Fests' }), name),
  el('div', { className: 'field' },
    el('span', { text: 'Icon' }),
    picker,
    el('div', { className: 'row' },
      el('div', { className: 'grow' }, custom),
      el('button', { type: 'button', className: 'btn secondary', text: 'Bild hochladen', onClick: () => file.click() }),
      file),
    el('div', { className: 'row' }, preview, removeImage)),
  submit,
  el('p', { className: 'muted small center', text: 'Feste laufen höchstens 3 Tage und werden 7 Tage nach dem Ende gelöscht.' }));

  renderPicker();

  fill(app, el('main', { className: 'page page-narrow stack' },
    el('div', { className: 'hero' },
      el('img', { src: '/favicon.svg', alt: '' }),
      el('h1', { text: 'DrinkTracker' }),
      el('p', { text: 'Der Live-Getränkezähler für euer Fest: Kassen buchen per Handy oder Tablet, der Bildschirm zeigt das Ranking, Gäste verfolgen ihr Team am eigenen Handy.' })),
    creationEnabled ? form : el('div', { className: 'card banner warn', text: 'Neue Feste können derzeit nicht angelegt werden.' })));
  if (creationEnabled) name.focus();
}

const app = $('#app');
api('/api/config')
  .then(({ creationEnabled }) => renderForm(app, creationEnabled))
  .catch((err) => {
    showError(err);
    renderForm(app, true);
  });
