#!/usr/bin/env bash
# Richtet das Android-Projekt für Vanilla Creme Radio ein (einmalig, auf dem Mac).
# Voraussetzung: Android Studio mit SDK + NDK, siehe ANDROID.md.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${ANDROID_HOME:-}" ] || [ -z "${NDK_HOME:-}" ]; then
  echo "Fehler: ANDROID_HOME und NDK_HOME müssen gesetzt sein (siehe ANDROID.md, Schritt 2)." >&2
  exit 1
fi

echo "→ Rust-Ziele für Android installieren"
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

echo "→ npm-Pakete installieren"
npm install

if [ ! -d src-tauri/gen/android ]; then
  echo "→ Android-Projekt erzeugen"
  npm run tauri android init
fi

# Radio-Streams laufen oft über unverschlüsseltes http://. Tauri erlaubt das
# standardmäßig nur im Debug-Build — für die fertige App ebenfalls freischalten.
GRADLE=src-tauri/gen/android/app/build.gradle.kts
perl -pi -e 's/manifestPlaceholders\["usesCleartextTraffic"\] = "false"/manifestPlaceholders["usesCleartextTraffic"] = "true"/' "$GRADLE"
if grep -q 'manifestPlaceholders\["usesCleartextTraffic"\] = "false"' "$GRADLE"; then
  echo "Warnung: HTTP-Freigabe in $GRADLE konnte nicht gesetzt werden — bitte manuell prüfen." >&2
else
  echo "→ HTTP-Streams in $GRADLE freigeschaltet"
fi

# Tauri legt das Android-Projekt mit seinem Standard-Logo an — eigenes App-Icon hineinkopieren.
cp -R src-tauri/icons/android/. src-tauri/gen/android/app/src/main/res/
echo "→ App-Icon übernommen"

echo
echo "Fertig. Weiter mit ANDROID.md, Schritt 4 (App aufs Handy bringen)."
