# Vanilla Creme Radio — Android-App (Tauri)

Die Android-App nutzt die mobile Oberfläche aus `docs/` und die Rust-Funktionen
aus `src-tauri/`. Netzwerkanfragen (Senderverzeichnis, DJ Sets, laufender
Titel) laufen über Rust, deshalb gibt es keine Browser-Beschränkungen:
HTTP-Sender spielen, DJ Sets laden, und der laufende Titel wird angezeigt.

Alle Schritte laufen auf dem Mac im Terminal, im Projektordner
(`/Users/felixh./Documents/12.Apps/RadioApp`).

## 1. Android Studio installieren

1. [Android Studio](https://developer.android.com/studio) herunterladen und installieren.
2. Android Studio öffnen → **More Actions → SDK Manager**.
3. Tab **SDK Platforms**: die neueste Android-Version anhaken.
4. Tab **SDK Tools**: anhaken:
   - Android SDK Build-Tools
   - Android SDK Command-line Tools
   - Android SDK Platform-Tools
   - NDK (Side by side)
5. **Apply** → herunterladen lassen.

## 2. Umgebungsvariablen setzen

Diese Zeilen ans Ende von `~/.zshrc` anhängen (z. B. mit `open -e ~/.zshrc`):

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk | tail -1)"
```

Danach das Terminal schließen und neu öffnen.

## 3. Projekt einrichten (einmalig)

```bash
git pull
bash scripts/android-setup.sh
```

Das Skript installiert die Rust-Ziele für Android, erzeugt das Android-Projekt
unter `src-tauri/gen/android`, schaltet HTTP-Streams frei und übernimmt das
App-Icon. Das erzeugte
Projekt danach committen:

```bash
git add src-tauri/gen/android && git commit -m "Add generated Android project" && git push
```

## 4. App aufs Handy bringen

**Variante A — per USB direkt starten (zum Testen):**

1. Am Handy die Entwickleroptionen aktivieren: *Einstellungen → Über das Telefon →
   7× auf „Build-Nummer" tippen*. Dann *Entwickleroptionen → USB-Debugging* einschalten.
2. Handy per USB anschließen, die Abfrage am Handy bestätigen.
3. ```bash
   npm run tauri android dev
   ```

**Variante B — APK-Datei bauen und installieren:**

```bash
npm run tauri android build -- --apk --debug
```

Die APK liegt danach unter `src-tauri/gen/android/app/build/outputs/apk/`.
Aufs Handy kopieren (z. B. per Google Drive oder Mail) und öffnen. Android
fragt einmalig, ob Installationen aus dieser Quelle erlaubt sind.

## Gut zu wissen

- **App-Kennung:** Android nutzt `com.felixh.vanillacremeradio`
  (`src-tauri/tauri.android.conf.json`). Die Desktop-App behält
  `com.felixh.radio`, damit die dort gespeicherten Sender erhalten bleiben.
- **App-Icon:** Das Setup-Skript kopiert die Icons aus `src-tauri/icons/android/`
  ins Android-Projekt. Bei einem neuen Icon `npm run tauri icon pfad/zum/icon.png`
  ausführen, das schreibt direkt ins Android-Projekt.
- **Play Store:** Dafür braucht es später einen signierten Release-Build
  (`npm run tauri android build -- --aab`) mit eigenem Signaturschlüssel.
- **Noch nicht umgesetzt:** Wiedergabe im Hintergrund bei gesperrtem
  Bildschirm und Steuerung über die Benachrichtigung. Ob der Ton beim
  Verlassen der App weiterläuft, bitte testen.
