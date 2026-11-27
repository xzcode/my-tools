use crate::{files::safe_name, trusted_main};
use serde::Deserialize;
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct KeyDirectoryStore(Mutex<()>);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyFile {
    name: String,
    bytes: Vec<u8>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join("key-directory.json"))
        .map_err(|e| e.to_string())
}

fn read_root(config: &Path, default: &Path) -> Result<(PathBuf, bool), String> {
    let file = match fs::File::open(config) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok((default.to_owned(), false));
        }
        Err(e) => return Err(format!("读取密钥目录设置失败：{e}")),
    };
    let mut data = Vec::new();
    file.take(16_385)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() > 16_384 {
        return Err("密钥目录设置过长，请重新选择目录。".into());
    }
    let root: PathBuf =
        serde_json::from_slice(&data).map_err(|_| "密钥目录设置损坏，请重新选择目录。")?;
    if !root.is_absolute() {
        return Err("密钥目录设置无效，请重新选择目录。".into());
    }
    Ok((root, true))
}

fn write_root(config: &Path, root: &Path) -> Result<(), String> {
    if !root.is_absolute() || !root.is_dir() {
        return Err("请选择有效的本机目录。".into());
    }
    let parent = config.parent().ok_or("无法定位配置目录")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(&serde_json::to_vec(root).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(config).map_err(|e| e.to_string())?;
    Ok(())
}

fn default_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map(|path| path.join("My Tools").join("Keys"))
        .map_err(|e| e.to_string())
}

fn root(app: &AppHandle) -> Result<(PathBuf, bool), String> {
    read_root(&config_path(app)?, &default_root(app)?)
}

fn display(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "目录路径不是有效 Unicode。".into())
}

fn usable_root(app: &AppHandle) -> Result<PathBuf, String> {
    let (path, selected) = root(app)?;
    if !selected {
        fs::create_dir_all(&path).map_err(|e| format!("无法创建默认密钥目录：{e}"))?;
    }
    if !path.is_dir() {
        return Err("已设置的密钥目录不存在，请重新选择。".into());
    }
    Ok(path)
}

#[tauri::command]
pub fn get_key_directory(window: WebviewWindow, app: AppHandle) -> Result<String, String> {
    trusted_main(&window)?;
    display(&root(&app)?.0)
}

#[tauri::command]
pub async fn choose_key_directory(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<String>, String> {
    trusted_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("选择默认密钥存储目录");
        if let Ok((path, _)) = root(&app) {
            if path.is_dir() {
                dialog = dialog.set_directory(path);
            }
        }
        let Some(chosen) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let path = chosen.into_path().map_err(|e| e.to_string())?;
        let shown = display(&path)?;
        let store = app.state::<KeyDirectoryStore>();
        let _guard = store.0.lock().map_err(|_| "密钥目录暂不可用")?;
        write_root(&config_path(&app)?, &path)?;
        Ok(Some(shown))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn validate(name: &str, algorithm: &str, files: &[KeyFile]) -> Result<(), String> {
    const ALGORITHMS: &[&str] = &[
        "RSA_2048",
        "RSA_3072",
        "RSA_4096",
        "ECDSA-P-256",
        "ECDSA-P-384",
        "ECDSA-P-521",
        "ECDH-P-256",
        "ECDH-P-384",
        "ECDH-P-521",
        "Ed25519",
        "X25519",
    ];
    if name.len() > 80 || !safe_name(name) || !ALGORITHMS.contains(&algorithm) {
        return Err("密钥名称或算法无效。".into());
    }
    let prefix = format!("{name}_");
    let mut names = HashSet::new();
    let mut private = false;
    let mut public = false;
    if files.is_empty() || files.len() > 13 {
        return Err("密钥文件清单无效。".into());
    }
    for file in files {
        if !safe_name(&file.name)
            || !names.insert(file.name.to_lowercase())
            || file.bytes.is_empty()
            || file.bytes.len() > 65_536
        {
            return Err("密钥文件名或内容大小无效。".into());
        }
        let suffix = file
            .name
            .strip_prefix(&prefix)
            .ok_or("密钥文件名必须包含密钥名称。")?;
        if suffix == "key-info.json" {
            continue;
        }
        let Some((kind, extension)) = suffix.split_once('.') else {
            return Err("密钥文件格式无效。".into());
        };
        if !matches!(extension, "pem" | "der" | "base64.txt") {
            return Err("不支持的密钥文件编码。".into());
        }
        match kind {
            "private_pkcs8" => private = true,
            "public_spki" => public = true,
            "private_pkcs1" if algorithm.starts_with("RSA_") => private = true,
            "public_pkcs1" if algorithm.starts_with("RSA_") => public = true,
            _ => return Err("不支持的密钥文件结构。".into()),
        }
    }
    if !private || !public {
        return Err("导出需要包含公钥和私钥。".into());
    }
    Ok(())
}

fn write_keys(
    parent: &Path,
    name: &str,
    algorithm: &str,
    files: &[KeyFile],
) -> Result<PathBuf, String> {
    validate(name, algorithm, files)?;
    let folder = format!("{name}_{algorithm}");
    let mut destination = parent.join(&folder);
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(&destination) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos();
            destination = parent.join(format!("{folder}_{stamp}"));
            builder.create(&destination).map_err(|e| e.to_string())?;
        }
        Err(e) => return Err(format!("创建密钥文件夹失败：{e}")),
    }
    let mut created = Vec::new();
    let result: Result<(), String> = (|| {
        for file in files {
            let path = destination.join(&file.name);
            let mut opts = fs::OpenOptions::new();
            opts.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            let mut output = opts.open(&path).map_err(|e| e.to_string())?;
            created.push(path);
            output.write_all(&file.bytes).map_err(|e| e.to_string())?;
            output.sync_all().map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        for path in created {
            let _ = fs::remove_file(path);
        }
        let _ = fs::remove_dir(&destination);
        return Err(error);
    }
    Ok(destination)
}

#[tauri::command]
pub async fn save_key_bundle(
    window: WebviewWindow,
    app: AppHandle,
    name: String,
    algorithm: String,
    files: Vec<KeyFile>,
) -> Result<String, String> {
    trusted_main(&window)?;
    validate(&name, &algorithm, &files)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<KeyDirectoryStore>();
        let _guard = store.0.lock().map_err(|_| "密钥目录暂不可用")?;
        let destination = write_keys(&usable_root(&app)?, &name, &algorithm, &files)?;
        display(&destination)
    })
    .await
    .map_err(|e| e.to_string())?
}

// Explicitly requested folder reveal. No shell or arbitrary executable,
// URL, command, or path can be supplied by the frontend.
#[tauri::command]
pub async fn open_key_directory(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    trusted_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = usable_root(&app)?;
        #[cfg(target_os = "macos")]
        let mut command = std::process::Command::new("/usr/bin/open");
        #[cfg(target_os = "windows")]
        let mut command = {
            let windows = std::env::var_os("SystemRoot").ok_or("无法定位系统文件管理器")?;
            std::process::Command::new(PathBuf::from(windows).join("explorer.exe"))
        };
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let mut command = std::process::Command::new("/usr/bin/xdg-open");
        command
            .arg(path)
            .spawn()
            .map_err(|e| format!("打开存储目录失败：{e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(name: &str) -> Vec<KeyFile> {
        ["private_pkcs8.pem", "public_spki.pem"]
            .iter()
            .map(|suffix| KeyFile {
                name: format!("{name}_{suffix}"),
                bytes: vec![1, 2, 3],
            })
            .collect()
    }

    #[test]
    fn directory_choice_persists_and_corruption_is_not_silently_reset() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("config/key-directory.json");
        let fallback = tmp.path().join("default");
        let selected = tmp.path().join("selected");
        fs::create_dir(&selected).unwrap();
        assert_eq!(
            read_root(&config, &fallback).unwrap(),
            (fallback.clone(), false)
        );
        write_root(&config, &selected).unwrap();
        assert_eq!(read_root(&config, &fallback).unwrap(), (selected, true));
        fs::write(&config, b"invalid").unwrap();
        assert!(read_root(&config, &fallback).is_err());
    }

    #[test]
    fn named_export_never_overwrites_and_rejects_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let files = sample("project");
        let first = write_keys(tmp.path(), "project", "RSA_2048", &files).unwrap();
        assert_eq!(first.file_name().unwrap(), "project_RSA_2048");
        let second = write_keys(tmp.path(), "project", "RSA_2048", &files).unwrap();
        assert_ne!(first, second);
        assert_eq!(
            fs::read(first.join(&files[0].name)).unwrap(),
            vec![1, 2, 3]
        );
        assert!(write_keys(tmp.path(), "../project", "RSA_2048", &files).is_err());
        let mut invalid = sample("project");
        invalid[0].name = "../private.pem".into();
        assert!(write_keys(tmp.path(), "project", "RSA_2048", &invalid).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&first).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(first.join(&files[0].name))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }
}
