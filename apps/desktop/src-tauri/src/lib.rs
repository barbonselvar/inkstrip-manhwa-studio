//! Inkstrip for Windows: a lightweight Tauri 2 shell around the production web app.
//!
//! The window first shows a bundled launcher page (offline check + retry) and then
//! navigates to the production site. Only that origin may load inside the window;
//! every other link opens in the user's default browser. The remote site gets no
//! Tauri IPC access (no capabilities are granted), so it runs exactly as it does in
//! a browser, with WebView2 handling file pickers and downloads natively.

use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{Manager, WebviewUrl};
use url::Url;

pub const PRODUCTION_URL: &str = "https://inkstrip-manhwa-studio.vercel.app/";

fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        // Bundled launcher page (tauri://localhost on macOS/Linux, http(s)://tauri.localhost on Windows).
        "tauri" => true,
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        // In-page resources the app creates itself (exports, previews).
        "blob" | "data" | "about" => true,
        "https" => url.host_str() == Url::parse(PRODUCTION_URL).ok().and_then(|u| u.host_str().map(str::to_owned)).as_deref(),
        _ => false,
    }
}

/// WRY's default WebView2 switches (kept when we add our own; see wry's webview2 module).
const WEBVIEW2_DEFAULT_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// Opt-in test hook used by CI (`apps/scripts/windows-device-test.ps1`): when
/// `INKSTRIP_WEBVIEW2_DEBUG_PORT` holds a port number, WebView2 exposes the DevTools
/// protocol on 127.0.0.1 so the installed app can be driven end to end. WRY always
/// passes explicit browser arguments, which makes WebView2 ignore the standard
/// `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` variable, hence this dedicated switch.
#[cfg_attr(not(windows), allow(dead_code))]
fn webview2_args(debug_port: Option<String>) -> Option<String> {
    let port: u16 = debug_port?.trim().parse().ok().filter(|p| *p >= 1024)?;
    Some(format!("{WEBVIEW2_DEFAULT_ARGS} --remote-debugging-port={port}"))
}

fn open_externally(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let version = app.package_info().version.to_string();
            let marker = format!(
                "Object.defineProperty(window, '__INKSTRIP_DESKTOP__', {{ value: Object.freeze({{ platform: 'windows', version: '{version}' }}) }});"
            );
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()));
            #[cfg(windows)]
            let builder = match webview2_args(std::env::var("INKSTRIP_WEBVIEW2_DEBUG_PORT").ok()) {
                Some(args) => builder.additional_browser_args(&args),
                None => builder,
            };
            builder
                .title("Inkstrip")
                .inner_size(1280.0, 800.0)
                .min_inner_size(800.0, 560.0)
                .center()
                .maximized(true)
                .background_color(tauri::window::Color(14, 14, 16, 255))
                .initialization_script(&marker)
                // Let the page receive file drops (image import) instead of Tauri intercepting them.
                .disable_drag_drop_handler()
                .on_navigation(|url| {
                    if is_app_url(url) {
                        true
                    } else {
                        open_externally(url);
                        false
                    }
                })
                .on_new_window(|url, _features| {
                    if is_app_url(&url) {
                        NewWindowResponse::Allow
                    } else {
                        open_externally(&url);
                        NewWindowResponse::Deny
                    }
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Inkstrip");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_port_hook_is_opt_in_and_validated() {
        assert_eq!(webview2_args(None), None);
        assert_eq!(webview2_args(Some("".into())), None);
        assert_eq!(webview2_args(Some("80".into())), None);
        assert_eq!(webview2_args(Some("9222; --evil".into())), None);
        let args = webview2_args(Some("9222".into())).unwrap();
        assert!(args.starts_with(WEBVIEW2_DEFAULT_ARGS));
        assert!(args.ends_with(" --remote-debugging-port=9222"));
    }

    #[test]
    fn only_production_and_local_urls_stay_in_app() {
        let ok = [
            "https://inkstrip-manhwa-studio.vercel.app/",
            "https://inkstrip-manhwa-studio.vercel.app/p/abc?x=1",
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/index.html",
            "tauri://localhost/index.html",
            "blob:https://inkstrip-manhwa-studio.vercel.app/1234",
            "about:blank",
        ];
        for u in ok {
            assert!(is_app_url(&Url::parse(u).unwrap()), "{u} should stay in app");
        }
        let external = [
            "https://github.com/barbonselvar/inkstrip-manhwa-studio",
            "http://inkstrip-manhwa-studio.vercel.app/",
            "https://inkstrip-manhwa-studio.vercel.app.evil.example/",
            "https://evil.example/?u=inkstrip-manhwa-studio.vercel.app",
            "file:///C:/Windows/System32/",
        ];
        for u in external {
            assert!(!is_app_url(&Url::parse(u).unwrap()), "{u} should open externally");
        }
    }
}
