import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PUBLIC_URL } from './config.js';
import { send } from './http.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const PAGE_FILES = ['index', 'manage', 'screen', 'counter', 'guest', 'report', 'admin', 'notfound'];
const pages = Object.fromEntries(await Promise.all(PAGE_FILES.map(async (name) => [name, await readFile(`${publicDir}${name}.html`, 'utf8')])));

const SITE = 'DrinkTracker';
const DEFAULT_DESCRIPTION = 'Der Live-Getränkezähler für Feste: Kassen buchen per Handy oder Tablet, der Bildschirm zeigt das Team-Ranking, Gäste verfolgen ihr Team am eigenen Handy.';

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Title, description and preview image for link previews (WhatsApp, Signal, Telegram, …).
export function metaTags({ title, description = DEFAULT_DESCRIPTION, path = '/' }) {
  const fullTitle = title ? `${title} · ${SITE}` : `${SITE} – Live-Getränkezähler für Feste`;
  const tags = [
    `<title>${escapeHtml(fullTitle)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${SITE}">`,
    `<meta property="og:title" content="${escapeHtml(fullTitle)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(PUBLIC_URL + path)}">`,
    `<meta property="og:image" content="${PUBLIC_URL}/og.png">`,
    '<meta property="og:image:type" content="image/png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${SITE} – Live-Getränkezähler für Feste">`,
    '<meta property="og:locale" content="de_DE">',
    '<meta name="twitter:card" content="summary_large_image">',
  ];
  return tags.join('\n  ');
}

export function page(res, name, meta = {}, status = 200) {
  res.setHeader('Cache-Control', 'no-store');
  send(res, status, pages[name].replace('<!--meta-->', metaTags(meta)), 'text/html; charset=utf-8');
}


// Link preview for crawlers plus an immediate forward for people (used for links that set a cookie first).
export function forwardPage(res, location, meta) {
  const target = escapeHtml(location);
  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex">
  <meta http-equiv="refresh" content="0;url=${target}">
  ${metaTags(meta)}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/style.css">
</head>
<body data-preset="blaulicht">
  <main class="page page-narrow"><div class="hero"><img src="/favicon.svg" alt=""><p><a class="btn primary" href="${target}">Weiter</a></p></div></main>
</body>
</html>`;
  res.setHeader('Cache-Control', 'no-store');
  send(res, 200, html, 'text/html; charset=utf-8');
}
