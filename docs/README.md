# Vanilla Creme Radio — Mobile (PWA)

Mobile Web-App-Version von Vanilla Creme Radio. Läuft im Browser auf iOS &
Android und lässt sich über „Zum Home-Bildschirm" wie eine native App
installieren (Vollbild, eigenes Icon, Offline-Shell).

## Hosting über GitHub Pages (kostenlos, HTTPS)

1. Im Repo auf GitHub: **Settings → Pages**
2. Unter **Build and deployment → Source**: *Deploy from a branch*
3. **Branch:** `main`, **Folder:** `/docs` → **Save**
4. Nach ein paar Minuten ist die App erreichbar unter:
   `https://felixcutsfilms.github.io/Vanilla-Creme-Radio-/`

Diese URL am Handy im Browser öffnen → Teilen-Menü → **„Zum Home-Bildschirm"**.

## Aufbau

| Datei | Zweck |
|-------|-------|
| `index.html` | App-Struktur & UI |
| `styles.css` | Mobile-Design (Vanilla-Creme-Farbschema, Safe-Area, Touch) |
| `app.js` | Logik: Player, Sender-Verwaltung, Entdecken, Media Session |
| `sw.js` | Service Worker (Offline-Shell, Installierbarkeit) |
| `manifest.webmanifest` | PWA-Manifest (Name, Icons, Farben) |
| `icons/` | App-Icons (192/512/apple-touch) |

## Unterschiede zur Desktop-Version (Tauri)

- **Netzwerk:** Radio-Browser-API & hearthis.at werden direkt per `fetch`
  abgefragt (statt über Rust). Radio-Browser erlaubt CORS → funktioniert.
- **DJ Sets (hearthis.at):** im reinen Browser durch CORS meist blockiert —
  die App zeigt dann einen Hinweis. Funktioniert zuverlässig nur im Desktop.
- **Laufender Track (ICY-Metadaten):** im Browser technisch nicht möglich,
  daher entfallen. Angezeigt werden Sendername & Genre.
- **Audio-Veredelung (Bass/Kompressor):** entfällt mobil — Cross-Origin-
  Streams würden über die Web-Audio-API sonst stumm bleiben. Direkte,
  zuverlässige Wiedergabe hat Vorrang.
- **Nur HTTPS-Streams:** Auf einer HTTPS-Seite blockiert der Browser
  unverschlüsselte `http://`-Streams (Mixed Content). Default-Sender sind
  deshalb HTTPS (SomaFM, DLF).
- **Steuerung:** Tray-Icon & Tastatur ersetzt durch Touch + Media Session
  (Play/Pause/Weiter vom Sperrbildschirm).

## Senderdaten

Senderverzeichnis via [radio-browser.info](https://www.radio-browser.info)
(Lizenz: CC BY 4.0).
