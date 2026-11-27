mod aes_workspace;
mod files;
mod key_files;
mod preferences;
mod updater;

use preferences::{valid_tool_id, Preferences};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Instant,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_window_state::StateFlags;

#[derive(Default)]
pub(crate) struct AppState {
    prefs: Mutex<Preferences>,
    settings_update: Mutex<()>,
    shortcut_error: Mutex<Option<String>>,
    tray_available: AtomicBool,
    drops: Mutex<HashMap<String, (Vec<PathBuf>, Instant)>>,
}

pub(crate) fn trusted(window: &WebviewWindow) -> Result<(), String> {
    if matches!(window.label(), "main" | "launcher") {
        Ok(())
    } else {
        Err("当前窗口无权执行此操作".into())
    }
}

pub(crate) fn trusted_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("请在主工作台中执行此操作".into())
    }
}

fn preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|p| p.join("preferences.json"))
        .map_err(|e| e.to_string())
}

fn reveal_main(app: &AppHandle, tool_id: Option<&str>) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("主窗口暂不可用")?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    if let Some(id) = tool_id {
        app.emit_to("main", "my-tools:open-tool", id)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn reveal_launcher(app: &AppHandle, toggle: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("launcher")
        .ok_or("快捷窗口暂不可用")?;
    if toggle && window.is_visible().unwrap_or(false) {
        return window.hide().map_err(|e| e.to_string());
    }
    window.center().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    app.emit_to("launcher", "my-tools:launcher-shown", ())
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn tool_name(id: &str) -> &str {
    match id {
        "json" => "JSON 工作台",
        "string-join" => "字符串拼接",
        "text" => "文本处理",
        "base64" => "Base64 编解码",
        "url" => "URL 工具",
        "timestamp" => "时间戳转换",
        "uuid" => "UUID 与随机字符串",
        "aes" => "AES 加解密",
        "password" => "强密码生成器",
        "hash" => "哈希与 HMAC",
        "jwt" => "JWT 解析",
        "sql" => "SQL 格式化",
        "sql-in" => "SQL IN 生成",
        "regex" => "正则测试",
        "text-diff" => "文本对比",
        "json-diff" => "JSON 对比",
        "convert" => "JSON · YAML · CSV",
        "curl" => "cURL 解析",
        "keygen" => "密钥生成",
        "key-match" => "密钥匹配",
        "key-format" => "密钥解析与转换",
        "signature" => "数字签名与验签",
        "rsa-crypto" => "RSA 加解密",
        "key-agreement" => "密钥协商",
        "packet-signing" => "报文签名原文",
        _ => id,
    }
}

fn tray_menu(app: &AppHandle, recent: &[String]) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(
        app,
        "open",
        "打开 My Tools",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "launcher",
        "快捷启动",
        true,
        None::<&str>,
    )?)?;
    if !recent.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        for id in recent.iter().take(5) {
            menu.append(&MenuItem::with_id(
                app,
                format!("tool:{id}"),
                format!("最近 · {}", tool_name(id)),
                true,
                None::<&str>,
            )?)?;
        }
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "quit",
        "退出 My Tools",
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

fn parse_shortcut(value: &str) -> Result<Option<Shortcut>, String> {
    if value.is_empty() {
        return Ok(None);
    }
    if !value.contains('+') {
        return Err("快捷键需要包含修饰键，例如 CmdOrCtrl+Shift+Space".into());
    }
    // Accept the same user-facing spelling on every OS.
    Shortcut::from_str(&value.replace("CmdOrCtrl", "CommandOrControl"))
        .map(Some)
        .map_err(|e| format!("快捷键格式无效：{e}"))
}

#[tauri::command]
async fn read_clipboard(window: WebviewWindow, app: AppHandle) -> Result<String, String> {
    trusted(&window)?;
    let text = app
        .clipboard()
        .read_text()
        .map_err(|e| format!("无法读取剪贴板文本：{e}"))?;
    if text.len() > files::MAX_INPUT_BYTES {
        return Err("剪贴板文本不能超过 5 MiB".into());
    }
    Ok(text)
}

#[tauri::command]
async fn write_clipboard(
    window: WebviewWindow,
    app: AppHandle,
    text: String,
) -> Result<(), String> {
    trusted(&window)?;
    if text.len() > files::MAX_BATCH_BYTES {
        return Err("复制内容不能超过 20 MiB".into());
    }
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("无法写入剪贴板：{e}"))
}

#[tauri::command]
fn load_preferences(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Preferences, String> {
    trusted(&window)?;
    state
        .prefs
        .lock()
        .map(|p| p.clone())
        .map_err(|_| "设置暂不可用".into())
}

#[tauri::command]
async fn save_preferences(
    window: WebviewWindow,
    app: AppHandle,
    mut preferences: Preferences,
) -> Result<Preferences, String> {
    trusted(&window)?;
    preferences.validate()?;
    tauri::async_runtime::spawn_blocking(move || save_preferences_inner(&app, preferences))
        .await
        .map_err(|e| e.to_string())?
}

fn save_preferences_inner(
    app: &AppHandle,
    preferences: Preferences,
) -> Result<Preferences, String> {
    let state = app.state::<AppState>();
    let _transaction = state
        .settings_update
        .lock()
        .map_err(|_| "设置更新暂不可用")?;
    let previous = state.prefs.lock().map_err(|_| "设置暂不可用")?.clone();
    let old_shortcut = parse_shortcut(&previous.shortcut).unwrap_or(None);
    let new_shortcut = parse_shortcut(&preferences.shortcut)?;
    let shortcut_changed = previous.shortcut != preferences.shortcut;
    let hotkeys = app.global_shortcut();
    let old_active = old_shortcut.is_some_and(|s| hotkeys.is_registered(s));
    let new_needed = shortcut_changed && new_shortcut.is_some_and(|s| !hotkeys.is_registered(s));
    if new_needed {
        if let Err(error) = hotkeys.register(new_shortcut.ok_or("快捷键无效")?) {
            return Err(format!("快捷键注册失败，可能已被其他应用占用：{error}"));
        }
    }
    let remove_old = old_active && old_shortcut != new_shortcut;
    if remove_old {
        if let Err(error) = hotkeys.unregister(old_shortcut.ok_or("旧快捷键无效")?) {
            if new_needed {
                if let Some(s) = new_shortcut {
                    let _ = hotkeys.unregister(s);
                }
            }
            return Err(format!("无法注销原快捷键：{error}"));
        }
    }
    if let Err(error) = preferences::write(&preferences_path(app)?, &preferences) {
        if new_needed {
            if let Some(s) = new_shortcut {
                let _ = hotkeys.unregister(s);
            }
        }
        if remove_old {
            if let Some(s) = old_shortcut {
                let _ = hotkeys.register(s);
            }
        }
        return Err(error);
    }
    *state.prefs.lock().map_err(|_| "设置暂不可用")? = preferences.clone();
    if shortcut_changed {
        *state
            .shortcut_error
            .lock()
            .map_err(|_| "快捷键状态暂不可用")? = None;
    }
    if let Some(tray) = app.tray_by_id("my-tools") {
        if let Ok(menu) = tray_menu(app, &preferences.recent) {
            let _ = tray.set_menu(Some(menu));
        }
    }
    let _ = app.emit("my-tools:preferences-changed", &preferences);
    Ok(preferences)
}

#[tauri::command]
fn show_main_window(
    window: WebviewWindow,
    app: AppHandle,
    tool_id: Option<String>,
) -> Result<(), String> {
    trusted(&window)?;
    if tool_id.as_ref().is_some_and(|id| !valid_tool_id(id)) {
        return Err("无效的工具标识".into());
    }
    reveal_main(&app, tool_id.as_deref())?;
    if window.label() == "launcher" {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_launcher(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    trusted(&window)?;
    reveal_launcher(&app, false)
}

#[tauri::command]
fn hide_current_window(window: WebviewWindow) -> Result<(), String> {
    trusted(&window)?;
    window.hide().map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    version: String,
    platform: String,
    shortcut: String,
    shortcut_error: Option<String>,
    tray_available: bool,
    updater_enabled: bool,
}

#[tauri::command]
fn get_desktop_status(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<DesktopStatus, String> {
    trusted(&window)?;
    Ok(DesktopStatus {
        version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        shortcut: state
            .prefs
            .lock()
            .map_err(|_| "设置暂不可用")?
            .shortcut
            .clone(),
        shortcut_error: state
            .shortcut_error
            .lock()
            .map_err(|_| "快捷键状态暂不可用")?
            .clone(),
        tray_available: state.tray_available.load(Ordering::Relaxed),
        updater_enabled: updater::enabled(),
    })
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = reveal_main(app, None);
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = reveal_launcher(app, true);
                    }
                })
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["launcher"])
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .manage(AppState::default())
        .manage(key_files::KeyDirectoryStore::default())
        .manage(aes_workspace::WorkspaceStore::default());
    #[cfg(feature = "updater")]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::PendingUpdate::default());

    let app = builder
        .setup(|app| {
            let handle = app.handle();
            let state = app.state::<AppState>();
            let preferences = preferences_path(handle)
                .map(|p| preferences::read(&p))
                .unwrap_or_default();
            *state.prefs.lock().map_err(|_| "settings unavailable")? = preferences.clone();

            for config in app.config().app.windows.clone() {
                WebviewWindowBuilder::from_config(app, &config)?
                    .on_navigation(|url| {
                        (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                            || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                            || (cfg!(debug_assertions)
                                && url.scheme() == "http"
                                && url.host_str() == Some("127.0.0.1")
                                && url.port() == Some(1420))
                    })
                    .build()?;
            }
            app.set_menu(Menu::default(handle)?)?;

            let initial_shortcut = parse_shortcut(&preferences.shortcut).and_then(|shortcut| {
                shortcut
                    .map(|s| app.global_shortcut().register(s).map_err(|e| e.to_string()))
                    .unwrap_or(Ok(()))
            });
            if let Err(error) = initial_shortcut {
                *state
                    .shortcut_error
                    .lock()
                    .map_err(|_| "shortcut state unavailable")? =
                    Some(format!("全局快捷键暂不可用：{error}"));
            }

            let tray = TrayIconBuilder::with_id("my-tools")
                .icon(tauri::image::Image::from_bytes(
                    if cfg!(target_os = "macos") {
                        include_bytes!("../icons/tray.png")
                    } else {
                        include_bytes!("../icons/32x32.png")
                    },
                )?)
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("My Tools · 离线开发工具箱")
                .menu(&tray_menu(handle, &preferences.recent)?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = reveal_main(app, None);
                    }
                    "launcher" => {
                        let _ = reveal_launcher(app, false);
                    }
                    "quit" => app.exit(0),
                    id if id.starts_with("tool:") => {
                        let _ = reveal_main(app, Some(&id[5..]));
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = reveal_main(tray.app_handle(), None);
                    }
                })
                .build(app);
            state.tray_available.store(tray.is_ok(), Ordering::Relaxed);
            // A missing system tray must never make a closed window unreachable.
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            let state = app.state::<AppState>();
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == "launcher" {
                        api.prevent_close();
                        let _ = window.hide();
                    } else if state.tray_available.load(Ordering::Relaxed)
                        && state.prefs.lock().map(|p| p.close_to_tray).unwrap_or(false)
                    {
                        api.prevent_close();
                        aes_workspace::flush_hidden(app);
                        let _ = window.hide();
                    } else {
                        app.exit(0);
                    }
                }
                WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. })
                    if window.label() == "main" =>
                {
                    if let Ok(mut drops) = state.drops.lock() {
                        drops.insert(window.label().into(), (paths.clone(), Instant::now()));
                    }
                    let _ = app.emit_to(window.label(), "my-tools:files-dropped", paths);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_clipboard,
            write_clipboard,
            aes_workspace::load_aes_workspace,
            aes_workspace::save_aes_workspace,
            aes_workspace::clear_aes_workspace,
            aes_workspace::enable_aes_workspace_exit_guard,
            aes_workspace::finish_aes_workspace_exit,
            files::open_text_files,
            files::save_text_file,
            files::save_batch_files,
            key_files::get_key_directory,
            key_files::choose_key_directory,
            key_files::save_key_bundle,
            key_files::open_key_directory,
            files::read_dropped_files,
            files::read_dropped_binary_file,
            load_preferences,
            save_preferences,
            files::open_binary_file,
            files::save_binary_file,
            show_main_window,
            show_launcher,
            hide_current_window,
            get_desktop_status,
            updater::check_for_updates,
            updater::install_update,
        ])
        .build(tauri::generate_context!())
        .expect("My Tools desktop failed to start");

    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            aes_workspace::intercept_exit(app, api);
        }
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            let _ = reveal_main(app, None);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app, event);
        }
    });
}
