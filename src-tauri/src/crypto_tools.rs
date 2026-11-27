use my_tools_crypto::{KeyFile, Request, ResultData};
use serde::Serialize;
use std::sync::Mutex;
static KEY_DIRECTORY_WRITE: Mutex<()> = Mutex::new(());
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|p| p.join("key-settings.json"))
        .map_err(|e| e.to_string())
}
fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = my_tools_crypto::load_key_directory(&settings_path(app)?)? {
        return Ok(dir);
    }
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    Ok(base.join("My Tools").join("Keys"))
}
fn save_directory(app: &AppHandle, dir: PathBuf) -> Result<(), String> {
    my_tools_crypto::store_key_directory(&settings_path(app)?, dir)
}
fn child(root: &Path, name: &str) -> Result<PathBuf, String> {
    let mut c = Path::new(name).components();
    if name.is_empty()
        || name.contains(['/', '\\'])
        || !matches!(c.next(), Some(std::path::Component::Normal(_)))
        || c.next().is_some()
    {
        return Err("无效的密钥目录名称".into());
    }
    let path = root.join(name);
    let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("只支持普通密钥目录".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if path.parent() != Some(root.as_path()) {
        return Err("密钥目录超出当前存储目录".into());
    }
    Ok(path)
}
#[tauri::command]
pub async fn crypto_execute(window: WebviewWindow, request: Request) -> Result<ResultData, String> {
    super::trusted_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || my_tools_crypto::execute(&request))
        .await
        .map_err(|_| "密码学任务异常结束".to_string())?
}
#[tauri::command]
pub fn crypto_get_directory(window: WebviewWindow, app: AppHandle) -> Result<String, String> {
    super::trusted_main(&window)?;
    Ok(directory(&app)?.to_string_lossy().into_owned())
}
#[tauri::command]
pub async fn crypto_choose_directory(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<String>, String> {
    super::trusted_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("选择默认密钥保存目录");
        if let Ok(dir) = directory(&app) {
            if dir.is_dir() {
                dialog = dialog.set_directory(dir);
            }
        }
        let Some(selected) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let dir = selected
            .into_path()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !dir.is_dir() {
            return Err("请选择文件夹".into());
        }
        let _guard = KEY_DIRECTORY_WRITE
            .lock()
            .map_err(|_| "密钥目录状态暂不可用")?;
        save_directory(&app, dir.clone())?;
        Ok(Some(dir.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn crypto_save_keys(
    window: WebviewWindow,
    app: AppHandle,
    name: String,
    files: Vec<KeyFile>,
) -> Result<String, String> {
    super::trusted_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = KEY_DIRECTORY_WRITE
            .lock()
            .map_err(|_| "密钥目录状态暂不可用")?;
        let dir = my_tools_crypto::save_key_files(&directory(&app)?, &name, &files)?;
        Ok(dir.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn crypto_open_directory(
    window: WebviewWindow,
    app: AppHandle,
    name: Option<String>,
) -> Result<(), String> {
    super::trusted_main(&window)?;
    let root = directory(&app)?;
    let dir = if let Some(name) = name {
        child(&root, &name)?
    } else {
        root
    };
    if !dir.is_dir() {
        return Err("目录尚不存在，请先保存密钥或选择已有目录".into());
    }
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| e.to_string())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeySet {
    name: String,
    files: Vec<String>,
    managed: bool,
}
const KEY_FILES: &[&str] = my_tools_crypto::KEY_FILE_NAMES;
#[tauri::command]
pub async fn crypto_list_keys(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Vec<KeySet>, String> {
    super::trusted_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = directory(&app)?;
        let iter = match fs::read_dir(&root) {
            Ok(i) => i,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e.to_string()),
        };
        let mut sets = Vec::new();
        for item in iter {
            let item = item.map_err(|e| e.to_string())?;
            let name = item.file_name().to_string_lossy().into_owned();
            let Ok(dir) = child(&root, &name) else {
                continue;
            };
            let files = KEY_FILES
                .iter()
                .filter(|f| {
                    fs::symlink_metadata(dir.join(f))
                        .is_ok_and(|m| m.is_file() && !m.file_type().is_symlink())
                })
                .map(|x| x.to_string())
                .collect::<Vec<_>>();
            if !files.is_empty() {
                let managed = my_tools_crypto::is_managed_key_directory(&root, &name);
                sets.push(KeySet {
                    name,
                    files,
                    managed,
                });
            }
        }
        sets.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(sets)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn crypto_read_key(
    window: WebviewWindow,
    app: AppHandle,
    name: String,
    file: String,
) -> Result<String, String> {
    super::trusted_main(&window)?;
    if !KEY_FILES.contains(&file.as_str()) {
        return Err("不支持的密钥文件".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dir = child(&directory(&app)?, &name)?;
        let path = dir.join(&file);
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("只支持普通密钥文件".into());
        }
        let data = fs::read(path).map_err(|e| e.to_string())?;
        if file.ends_with(".der") || file.ends_with(".p12") || file.ends_with(".jks") {
            Ok(my_tools_crypto::encode_der(&data))
        } else {
            String::from_utf8(data).map_err(|_| "密钥文件不是 UTF-8 文本".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crypto_rename_key_set(
    window: WebviewWindow,
    app: AppHandle,
    name: String,
    new_name: String,
    expected_directory: String,
) -> Result<String, String> {
    super::trusted_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = KEY_DIRECTORY_WRITE
            .lock()
            .map_err(|_| "密钥目录状态暂不可用")?;
        let root = directory(&app)?;
        if root != PathBuf::from(expected_directory) {
            return Err("默认目录已改变，请刷新密钥库后重试".into());
        }
        let path = my_tools_crypto::rename_key_directory(&root, &name, &new_name)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn crypto_delete_key_set(
    window: WebviewWindow,
    app: AppHandle,
    name: String,
    confirmed_name: String,
    expected_directory: String,
) -> Result<(), String> {
    super::trusted_main(&window)?;
    if name != confirmed_name {
        return Err("请输入准确的密钥组名称以确认删除".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = KEY_DIRECTORY_WRITE
            .lock()
            .map_err(|_| "密钥目录状态暂不可用")?;
        let root = directory(&app)?;
        if root != PathBuf::from(expected_directory) {
            return Err("默认目录已改变，请刷新密钥库后重试".into());
        }
        my_tools_crypto::delete_key_directory(&root, &name)
    })
    .await
    .map_err(|e| e.to_string())?
}
