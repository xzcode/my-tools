use crate::trusted_main;
use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    available: bool,
    version: Option<String>,
    notes: Option<String>,
    message: String,
}

pub fn enabled() -> bool {
    cfg!(feature = "updater")
        && option_env!("MY_TOOLS_UPDATE_ENDPOINT")
            .is_some_and(|s| s.starts_with("https://") && s.len() > 8)
        && option_env!("MY_TOOLS_UPDATE_PUBKEY").is_some_and(|s| !s.trim().is_empty())
}

#[cfg(feature = "updater")]
#[derive(Default)]
pub struct PendingUpdate(pub std::sync::Mutex<Option<tauri_plugin_updater::Update>>);

#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<UpdateStatus, String> {
    trusted_main(&window)?;
    if !enabled() {
        return Ok(UpdateStatus {
            available: false,
            version: None,
            notes: None,
            message: "此版本未配置签名更新源，请下载新安装包手动更新。".into(),
        });
    }
    #[cfg(feature = "updater")]
    {
        use tauri::Manager;
        use tauri_plugin_updater::UpdaterExt;
        let endpoint = option_env!("MY_TOOLS_UPDATE_ENDPOINT")
            .ok_or("未配置更新地址")?
            .parse()
            .map_err(|_| "更新地址无效")?;
        let update = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .map_err(|e| e.to_string())?
            .pubkey(option_env!("MY_TOOLS_UPDATE_PUBKEY").ok_or("未配置更新公钥")?)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| format!("检查更新失败：{e}"))?;
        let status = UpdateStatus {
            available: update.is_some(),
            version: update.as_ref().map(|u| u.version.clone()),
            notes: update.as_ref().and_then(|u| u.body.clone()),
            message: if update.is_some() {
                "发现新版本，安装前请保存当前工作。"
            } else {
                "当前已是最新版本。"
            }
            .into(),
        };
        *app.state::<PendingUpdate>()
            .0
            .lock()
            .map_err(|_| "更新状态暂不可用")? = update;
        Ok(status)
    }
    #[cfg(not(feature = "updater"))]
    {
        let _ = app;
        Err("未启用更新功能".into())
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    trusted_main(&window)?;
    if !enabled() {
        return Err("此版本未配置签名更新源".into());
    }
    #[cfg(feature = "updater")]
    {
        use tauri::{Emitter, Manager};
        let update = app
            .state::<PendingUpdate>()
            .0
            .lock()
            .map_err(|_| "更新状态暂不可用")?
            .take()
            .ok_or("请先检查更新")?;
        let handle = app.clone();
        let mut downloaded = 0u64;
        update
            .download_and_install(
                move |chunk, total| {
                    downloaded += chunk as u64;
                    let _ = handle.emit(
                        "my-tools:update-progress",
                        serde_json::json!({ "downloaded": downloaded, "total": total }),
                    );
                },
                || {},
            )
            .await
            .map_err(|e| format!("更新安装失败：{e}"))?;
        // Explicit install action is the only path here. Plugin verifies the update signature.
        app.restart();
    }
    #[cfg(not(feature = "updater"))]
    {
        let _ = app;
        Err("未启用更新功能".into())
    }
}
