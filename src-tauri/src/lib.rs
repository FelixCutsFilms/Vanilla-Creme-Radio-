use futures_util::StreamExt;
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Runtime,
};

fn show_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn emit<R: Runtime>(app: &tauri::AppHandle<R>, event: &str, payload: &str) {
    let _ = app.emit(event, payload.to_string());
}

/// Liest ICY-Metadaten (StreamTitle) aus einem Radiostream.
/// Gibt den Songtitel zurück oder einen Fehler wenn nicht verfügbar.
#[tauri::command]
async fn fetch_hearthis(path: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    // hearthis.at liefert (besonders beim Popular-Feed) zeitweise einen leeren
    // Body mit Status 200 zurück. Da der Endpunkt intermittierend funktioniert,
    // wird bei leerer Antwort mehrfach erneut versucht.
    let mut last_err = String::from("leere Antwort von hearthis.at");
    for attempt in 0..5 {
        match client
            .get(format!("https://api-v2.hearthis.at/{}", path))
            .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(resp) => match resp.text().await {
                Ok(body) if body.trim().len() > 2 => return Ok(body),
                Ok(_) => last_err = String::from("leere Antwort von hearthis.at"),
                Err(e) => last_err = e.to_string(),
            },
            Err(e) => last_err = e.to_string(),
        }
        if attempt < 4 {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        }
    }
    Err(last_err)
}

/// Radio-Browser-Suche über Rust — umgeht WebView-Netzwerk-Quirks und
/// probiert mehrere Mirror-Server falls einer down ist.
#[tauri::command]
async fn fetch_radio(path: String) -> Result<String, String> {
    let mirrors = [
        "https://de1.api.radio-browser.info",
        "https://de2.api.radio-browser.info",
        "https://nl1.api.radio-browser.info",
        "https://at1.api.radio-browser.info",
        "https://fi1.api.radio-browser.info",
    ];

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut last_err = String::from("keine Mirrors erreichbar");
    for base in mirrors {
        let url = format!("{}/json/{}", base, path);
        match client
            .get(&url)
            .header("User-Agent", "VanillaCremeRadio/1.0")
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                match resp.text().await {
                    Ok(body) => return Ok(body),
                    Err(e) => last_err = e.to_string(),
                }
            }
            Ok(resp) => last_err = format!("HTTP {}", resp.status()),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(last_err)
}

#[tauri::command]
async fn resolve_stream_url(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .header("Referer", "https://hearthis.at/")
        .header("Origin", "https://hearthis.at")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(response.url().to_string())
}

#[tauri::command]
async fn fetch_icy_metadata(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .header("Icy-MetaData", "1")
        .header("User-Agent", "VanillaCremeRadio/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // Metaint = Abstand in Bytes zwischen Metadatenblöcken
    let metaint = response
        .headers()
        .get("icy-metaint")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok())
        .ok_or_else(|| "kein icy-metaint Header".to_string())?;

    // Nur genug Bytes lesen: metaint Audio + 1 Längen-Byte + max 255*16 Metadata
    let max_read = metaint + 1 + 255 * 16;
    let mut buf: Vec<u8> = Vec::with_capacity(max_read);
    let mut stream = response.bytes_stream();

    while buf.len() < max_read {
        match stream.next().await {
            Some(Ok(chunk)) => {
                buf.extend_from_slice(&chunk);
            }
            _ => break,
        }
    }

    if buf.len() <= metaint {
        return Err("nicht genug Daten".to_string());
    }

    let meta_len = buf[metaint] as usize * 16;
    if meta_len == 0 {
        return Err("leere Metadaten".to_string());
    }

    let end = metaint + 1 + meta_len;
    if buf.len() < end {
        return Err("unvollständige Metadaten".to_string());
    }

    let meta = String::from_utf8_lossy(&buf[metaint + 1..end]);

    // Format: StreamTitle='Artist - Title';StreamUrl='...';
    if let Some(start) = meta.find("StreamTitle='") {
        let rest = &meta[start + 13..];
        if let Some(end_idx) = rest.find("';") {
            let title = rest[..end_idx].trim().to_string();
            if !title.is_empty() {
                return Ok(title);
            }
        }
    }

    Err("kein Titel gefunden".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![fetch_icy_metadata, resolve_stream_url, fetch_hearthis, fetch_radio])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            let icon = app.default_window_icon().unwrap().clone();

            let play   = MenuItem::with_id(app, "play",   "Spielen",         true, None::<&str>)?;
            let pause  = MenuItem::with_id(app, "pause",  "Pause",           true, None::<&str>)?;
            let next   = MenuItem::with_id(app, "next",   "Nächster Sender", true, None::<&str>)?;

            let vol25  = MenuItem::with_id(app, "vol25",  "25 %",  true, None::<&str>)?;
            let vol50  = MenuItem::with_id(app, "vol50",  "50 %",  true, None::<&str>)?;
            let vol75  = MenuItem::with_id(app, "vol75",  "75 %",  true, None::<&str>)?;
            let vol100 = MenuItem::with_id(app, "vol100", "100 %", true, None::<&str>)?;
            let volume = Submenu::with_id_and_items(app, "volume", "Lautstärke", true, &[&vol25, &vol50, &vol75, &vol100])?;

            let sep  = tauri::menu::PredefinedMenuItem::separator(app)?;
            let show = MenuItem::with_id(app, "show", "Fenster öffnen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden",        true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&play, &pause, &next, &volume, &sep, &show, &quit])?;

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("Vanilla Creme Radio")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "play"   => emit(app, "tray-play",   ""),
                    "pause"  => emit(app, "tray-pause",  ""),
                    "next"   => emit(app, "tray-next",   ""),
                    "vol25"  => emit(app, "tray-volume", "0.25"),
                    "vol50"  => emit(app, "tray-volume", "0.5"),
                    "vol75"  => emit(app, "tray-volume", "0.75"),
                    "vol100" => emit(app, "tray-volume", "1.0"),
                    "show"   => show_window(app),
                    "quit"   => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
