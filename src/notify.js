import { PUSHOVER_TOKEN, PUSHOVER_USER, PUBLIC_URL } from './config.js';

export const pushoverEnabled = Boolean(PUSHOVER_TOKEN && PUSHOVER_USER);

export async function sendPushover(title, message) {
  if (!pushoverEnabled) return;
  const form = new URLSearchParams({
    token: PUSHOVER_TOKEN,
    user: PUSHOVER_USER,
    title: title.slice(0, 250),
    message: message.length > 1024 ? `${message.slice(0, 1023)}…` : message,
    url: `${PUBLIC_URL}/admin`,
    url_title: 'Admin',
  });
  try {
    const res = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error('Pushover failed', res.status, await res.text());
  } catch (err) {
    console.error('Pushover failed', err);
  }
}
