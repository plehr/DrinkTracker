# DrinkTracker

<img src="public/icon-128.png" alt="" width="96" align="right">

Live-Getränkezähler für Feste: Kassen buchen per Handy oder Tablet, ein großer Bildschirm zeigt das
Team-Ranking, und Gäste verfolgen am eigenen Handy, auf welchem Platz ihr Team steht.

Gedacht für Feuerwehrfeste und ähnliche Veranstaltungen, bei denen Teams um die meisten Getränke
wetteifern. Kein Login nötig: Wer ein Fest startet, verwaltet es über einen geheimen Link.

## Funktionen

- **Fest starten** ohne Konto: Name und Icon (Emoji oder Bild) angeben, danach erscheint die geheime Verwaltungs-URL.
- **Kassen** verbinden sich per QR-Code. Jedes Gerät bekommt einen Namen (z. B. „Kasse 1“, „Kasse Bier“). Gebucht wird mit großen Team-Kacheln, Getränkeart und Menge, „Rückgängig“ ist möglich.
- **Public Screen** für TV oder Beamer: animiertes Ranking mit Balken, Siegerpodest zum Schluss und ein QR-Code für Gäste, der sich ausblenden lässt.
- **Gäste** wählen ihr Team oder gründen ein eigenes und sehen Platz, Punkte und Abstand zum Team davor bzw. dahinter. Das gründende Gerät ist Team-Owner und kann den Owner-Zugang per QR-Code weitergeben.
- **Verwaltung**: Teams, Getränkearten mit Punkten, Design (Farben, Hintergrund, Balken-Symbol, Icon), Statistik, Buchungsprotokoll mit Filtern je Kasse/Team/Getränk/Zeitraum, Stornos sowie Export als CSV und PDF-Bericht.
- **Live** per WebSocket. Rechts oben zeigt ein grüner Punkt die Verbindung an. Ohne Verbindung erscheint ein oranger Refresh-Button, der nach einem Klick 30 Sekunden ausgeblendet bleibt.
- **Mehrere Feste gleichzeitig**, jedes mit eigenen Teams, Kassen, Design und Links.
- **Admin-Bereich** (optional, OpenID Connect) unter `/admin`: alle Feste sehen, bearbeiten, schließen und löschen sowie das Anlegen neuer Feste global stoppen. Der Bereich ist nirgends verlinkt.
- **Pushover** (optional): Benachrichtigung an den Admin, wenn ein neues Fest gestartet wird.
- Alle Seiten sind für Handys optimiert, die Kasse lässt sich als PWA im Vollbild nutzen.

## Links und Rollen

| Link | Für | Kann |
|---|---|---|
| `/m/<token>` | Veranstalter (geheim) | Alles verwalten, Statistik, Protokoll, Export, Fest beenden |
| `/m/<token>/screen` | Bildschirm vor Ort | Ranking und Gäste-QR anzeigen (Doppelklick = Vollbild) |
| `/t/<token>` | Kassen (privat) | Buchen, Teams anlegen und umbenennen, Owner-QR zeigen |
| `/p/<id>` | Gäste (öffentlich) | Team wählen oder gründen, eigenen Platz sehen |
| `/p/<id>/o/<token>` | Team-Owner | Owner-Zugang übernehmen (setzt ein Cookie) |
| `/admin` | Plattform-Admins (OIDC) | Alle Feste verwalten, Anlegen stoppen |

Statistik und die letzten Buchungen sieht nur der Veranstalter. Über den öffentlichen Link und den
WebSocket gehen ausschließlich Ranking-Daten raus.

Die Tokens werden mit AES-GCM verschlüsselt gespeichert (Schlüssel `TOKEN_KEY`), gesucht wird über
einen HMAC-Index. Der Kassen- und der Owner-Link lassen sich in der Verwaltung erneuern.

## Lebensdauer

- Ein Fest läuft **höchstens 3 Tage** ab dem Start. Der Veranstalter oder ein Admin kann es früher beenden.
- Danach ist nichts mehr änderbar; Endstand, Statistik und Export bleiben abrufbar.
- **7 Tage** nach der letzten Aktivität wird ein beendetes Fest samt aller Daten gelöscht. Der Aufräumlauf läuft alle 5 Minuten.

## Schnellstart (Docker)

```bash
docker network create drinktracker
docker run -d --name drinktracker-db --network drinktracker \
  -e POSTGRES_USER=drinktracker -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=drinktracker \
  postgres:18-alpine
docker run -d --name drinktracker --network drinktracker -p 3000:3000 \
  -e PUBLIC_URL=http://localhost:3000 \
  -e PGHOST=drinktracker-db -e PGUSER=drinktracker -e PGPASSWORD=change-me -e PGDATABASE=drinktracker \
  -e TOKEN_KEY="$(openssl rand -hex 32)" \
  ghcr.io/plehr/drinktracker:latest
```

Danach <http://localhost:3000> öffnen. Das Datenbankschema legt die App beim Start selbst an.

`TOKEN_KEY` muss dauerhaft gleich bleiben, sonst funktionieren die bestehenden Links nicht mehr.

## Konfiguration

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `PUBLIC_URL` | ja | Öffentliche Basis-URL, z. B. `https://drinks.example.com` (für Links, QR-Codes, Cookies, OIDC) |
| `TOKEN_KEY` | ja | Mindestens 32 zufällige Zeichen; verschlüsselt und indiziert die geheimen Links |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | ja | PostgreSQL-Verbindung (Standard-libpq-Variablen) |
| `PORT` | nein | Port des Servers (Standard `3000`) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_SECRET` | nein | Aktiviert `/admin`. Redirect-URI: `$PUBLIC_URL/admin/callback` |
| `PUSHOVER_TOKEN`, `PUSHOVER_USER` | nein | Push an den Admin bei jedem neuen Fest |

Eine Vorlage mit Platzhaltern liegt in [`.env.example`](.env.example).

Für die lokale Entwicklung ohne OIDC schalten `NODE_ENV=development` und `DEV_ADMIN=1` den Admin-Bereich
ohne Anmeldung frei. In Produktion hat das keine Wirkung.

## Betrieb hinter einem Reverse Proxy

- Der Proxy muss **WebSocket-Upgrades** auf `/ws` durchreichen. Die Lese- und Sende-Timeouts sollten großzügig sein (z. B. 3600 s); die App schickt alle 15 s einen Ping.
- Die Client-IP für das Rate-Limit liest die App aus `X-Real-IP` bzw. `X-Forwarded-For`.
- Mehrere Replikas sind möglich: Live-Updates laufen über PostgreSQL `LISTEN/NOTIFY`, den Aufräumlauf schützt ein Advisory-Lock.
- Das Image gibt es für `linux/amd64` und `linux/arm64`. Es läuft als Nicht-Root-Benutzer (UID 1000).

## Entwicklung

Node.js 22, ES-Module, kein Framework und kein Build-Schritt. Abhängigkeiten: `pg`, `ws`, `qrcode-generator`.

```bash
npm install
PUBLIC_URL=http://localhost:3000 TOKEN_KEY=dev-key-change-me-0123456789abcdef \
  PGHOST=localhost PGUSER=drinktracker PGPASSWORD=change-me PGDATABASE=drinktracker \
  NODE_ENV=development DEV_ADMIN=1 npm start
```

```
src/
  server.js      HTTP-Server, statische Dateien, Seiten-Routing
  routes.js      API (Start, Gäste, Kasse, Verwaltung, Admin)
  live.js        WebSocket + LISTEN/NOTIFY
  cleanup.js     Feste schließen und löschen
  festivals.js   Feste, Design, Icon, Einstellungen
  teams.js, drinks.js, devices.js, entries.js, stats.js
  tokens.js      Token-Erzeugung, Verschlüsselung, Index
  auth.js        OIDC-Login für /admin
  notify.js      Pushover
public/
  index, manage, screen, counter, guest, report, admin (.html + .js)
  common.js      DOM-Helfer, Live-Verbindung, QR, Theme
  style.css      alle Styles inkl. Themes (Blaulicht, Dunkel, Hell, Feuer) und Druckansicht
```

Bei jedem Push auf `main` baut [`.github/workflows/build.yml`](.github/workflows/build.yml) das Image und
veröffentlicht es als `ghcr.io/plehr/drinktracker` (Tags `latest` und `sha-…`).

## Icon

`public/favicon.svg` ist die Quelle, `public/icon-128.png` und `public/icon-512.png` sind daraus
gerendert (transparenter Hintergrund). Das 128er-PNG eignet sich z. B. als App-Icon für Pushover
oder einen Identity Provider.
