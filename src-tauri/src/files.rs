use crate::{trusted, AppState};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

pub const MAX_INPUT_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_BATCH_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_FILES: usize = 20;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFile {
    pub name: String,
    pub content: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportFile {
    pub name: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct BinaryFile {
    name: String,
    bytes: Vec<u8>,
}

fn read_bounded_file(path: &Path) -> Result<Vec<u8>, String> {
    let info = fs::symlink_metadata(path).map_err(|e| format!("读取文件信息失败：{e}"))?;
    if !info.is_file() || info.file_type().is_symlink() {
        return Err("只支持普通文件，不支持目录或符号链接".into());
    }
    if info.len() > MAX_INPUT_BYTES as u64 {
        return Err("单个文件不能超过 5 MiB".into());
    }
    let file = fs::File::open(path).map_err(|e| format!("打开文件失败：{e}"))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("只支持普通文件".into());
    }
    let mut data = Vec::new();
    file.take((MAX_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() > MAX_INPUT_BYTES {
        return Err("单个文件不能超过 5 MiB".into());
    }
    Ok(data)
}

pub fn safe_name(name: &str) -> bool {
    if name.is_empty()
        || name.len() > 180
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return false;
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str()) {
        return false;
    }
    !((stem.starts_with("COM") || stem.starts_with("LPT"))
        && stem.len() == 4
        && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

fn read_files(paths: Vec<PathBuf>) -> Result<Vec<ImportedFile>, String> {
    if paths.len() > MAX_FILES {
        return Err("一次最多导入 20 个文件".into());
    }
    let mut total = 0usize;
    let mut result = Vec::with_capacity(paths.len());
    for path in paths {
        let data = read_bounded_file(&path)?;
        total += data.len();
        if data.len() > MAX_INPUT_BYTES || total > MAX_BATCH_BYTES {
            return Err("单文件上限 5 MiB，一批文件总量上限 20 MiB".into());
        }
        let name = path
            .file_name()
            .ok_or("无效的文件名")?
            .to_string_lossy()
            .to_string();
        let content = String::from_utf8(data)
            .map_err(|_| format!("{name} 不是有效的 UTF-8 文本，请先转换文件编码"))?;
        result.push(ImportedFile { name, content });
    }
    Ok(result)
}

#[tauri::command]
pub async fn open_binary_file(
    app: AppHandle,
    window: WebviewWindow,
    kind: Option<String>,
) -> Result<Option<BinaryFile>, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let svga = kind.as_deref() == Some("svga");
        let mut dialog = app.dialog().file().set_parent(&window).set_title(if svga {
            "选择本地 SVGA 动画（最多 5 MiB）"
        } else {
            "选择需要 Base64 编码的文件（最多 5 MiB）"
        });
        if svga {
            dialog = dialog.add_filter("SVGA 动画", &["svga"]);
        }
        let Some(selected) = dialog.blocking_pick_file() else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        if svga
            && !path
                .extension()
                .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("svga"))
        {
            return Err("请选择 .svga 文件".into());
        }
        let bytes = read_bounded_file(&path)?;
        let name = path
            .file_name()
            .ok_or("无效的文件名")?
            .to_string_lossy()
            .to_string();
        Ok(Some(BinaryFile { name, bytes }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_binary_file(
    app: AppHandle,
    window: WebviewWindow,
    bytes: Vec<u8>,
    name: String,
) -> Result<bool, String> {
    trusted(&window)?;
    if bytes.len() > MAX_INPUT_BYTES {
        return Err("二进制文件不能超过 5 MiB".into());
    }
    if !safe_name(&name) {
        return Err("导出文件名包含不支持的字符".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("保存解码后的文件")
            .set_file_name(name)
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let parent = path.parent().ok_or("无法定位保存目录")?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        temp.write_all(&bytes)
            .map_err(|e| format!("保存失败：{e}"))?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(path).map_err(|e| format!("保存失败：{e}"))?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_text_files(
    app: AppHandle,
    window: WebviewWindow,
    multiple: bool,
) -> Result<Vec<ImportedFile>, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("导入 UTF-8 文本文件");
        let selected = if multiple {
            dialog.blocking_pick_files().unwrap_or_default()
        } else {
            dialog.blocking_pick_file().into_iter().collect()
        };
        let paths = selected
            .into_iter()
            .map(|p| p.into_path().map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        read_files(paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_dropped_files(
    window: WebviewWindow,
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ImportedFile>, String> {
    trusted(&window)?;
    let (allowed, when) = state
        .drops
        .lock()
        .map_err(|_| "文件拖放状态暂不可用")?
        .remove(window.label())
        .ok_or("请先将文件拖入当前窗口")?;
    if when.elapsed() > Duration::from_secs(30) || paths.len() > MAX_FILES || paths.is_empty() {
        return Err("拖放操作已过期或文件数量超限，请重新拖入文件".into());
    }
    let requested: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    if requested.iter().any(|p| !allowed.contains(p)) {
        return Err("只能读取刚刚拖入当前窗口的文件".into());
    }
    tauri::async_runtime::spawn_blocking(move || read_files(requested))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_dropped_binary_file(
    window: WebviewWindow,
    path: String,
    state: State<'_, AppState>,
) -> Result<BinaryFile, String> {
    trusted(&window)?;
    let (allowed, when) = state
        .drops
        .lock()
        .map_err(|_| "文件拖放状态暂不可用")?
        .remove(window.label())
        .ok_or("请先将文件拖入当前窗口")?;
    let requested = PathBuf::from(path);
    if when.elapsed() > Duration::from_secs(30)
        || allowed.len() != 1
        || !allowed.contains(&requested)
    {
        return Err("只能读取刚刚拖入当前窗口的单个文件".into());
    }
    if !requested
        .extension()
        .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("svga"))
    {
        return Err("请选择 .svga 文件".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_bounded_file(&requested)?;
        let name = requested
            .file_name()
            .ok_or("无效的文件名")?
            .to_string_lossy()
            .to_string();
        Ok(BinaryFile { name, bytes })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_text_file(
    app: AppHandle,
    window: WebviewWindow,
    content: String,
    name: String,
) -> Result<bool, String> {
    trusted(&window)?;
    if content.len() > MAX_BATCH_BYTES {
        return Err("导出内容不能超过 20 MiB".into());
    }
    if !safe_name(&name) {
        return Err("导出文件名包含不支持的字符".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("保存处理结果")
            .set_file_name(name)
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let parent = path.parent().ok_or("无法定位保存目录")?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        temp.write_all(content.as_bytes())
            .map_err(|e| format!("保存失败：{e}"))?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(path).map_err(|e| format!("保存失败：{e}"))?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn validate_export(files: &[ExportFile]) -> Result<(), String> {
    if files.is_empty() || files.len() > MAX_FILES {
        return Err("一次只能导出 1–20 个文件".into());
    }
    let mut names = HashSet::new();
    let mut bytes = 0usize;
    for file in files {
        if !safe_name(&file.name) || !names.insert(file.name.to_lowercase()) {
            return Err("批量导出文件名无效或重复，请使用不同的文件名".into());
        }
        bytes = bytes
            .checked_add(file.content.len())
            .ok_or("文件总量超限")?;
        if bytes > MAX_BATCH_BYTES {
            return Err("批量导出总量不能超过 20 MiB".into());
        }
    }
    Ok(())
}

fn write_batch(parent: &Path, files: &[ExportFile]) -> Result<usize, String> {
    // Each export gets a fresh directory; no existing user file is replaced.
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let destination = parent.join(format!("my-tools-export-{stamp}"));
    fs::create_dir(&destination).map_err(|e| format!("创建导出目录失败：{e}"))?;
    let mut created = vec![];
    let result = (|| {
        for file in files {
            let path = destination.join(&file.name);
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|e| e.to_string())?;
            created.push(path);
            output
                .write_all(file.content.as_bytes())
                .map_err(|e| e.to_string())?;
            output.sync_all().map_err(|e| e.to_string())?;
        }
        Ok(files.len())
    })();
    if result.is_err() {
        for path in created {
            let _ = fs::remove_file(path);
        }
        let _ = fs::remove_dir(&destination);
    }
    result
}

#[tauri::command]
pub async fn save_batch_files(
    app: AppHandle,
    window: WebviewWindow,
    files: Vec<ExportFile>,
) -> Result<usize, String> {
    trusted(&window)?;
    validate_export(&files)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("选择批量导出目录（将创建新的结果文件夹）")
            .blocking_pick_folder()
        else {
            return Ok(0);
        };
        let directory = selected.into_path().map_err(|e| e.to_string())?;
        write_batch(&directory, &files)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_names_reject_traversal_and_windows_reserved_names() {
        for name in [
            "",
            "..",
            "../secret",
            "a/b.txt",
            "a\\b.txt",
            "CON.txt",
            "LPT1",
            "a.",
            "a ",
            "a:b.txt",
        ] {
            assert!(!safe_name(name), "{name}");
        }
        for name in ["result.json", "处理结果.txt", "ids-2026.csv"] {
            assert!(safe_name(name));
        }
    }

    #[test]
    fn invalid_utf8_is_rejected_without_lossy_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("binary.bin");
        fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(read_files(vec![path]).is_err());
    }

    #[test]
    fn oversized_files_and_directories_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_files(vec![dir.path().to_path_buf()]).is_err());
        let path = dir.path().join("large.txt");
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_INPUT_BYTES as u64 + 1).unwrap();
        assert!(read_files(vec![path]).is_err());
    }

    #[test]
    fn duplicate_names_are_rejected_case_insensitively() {
        let files = vec![
            ExportFile {
                name: "a.json".into(),
                content: "{}".into(),
            },
            ExportFile {
                name: "A.json".into(),
                content: "[]".into(),
            },
        ];
        assert!(validate_export(&files).is_err());
    }

    #[test]
    fn batch_creates_new_directory_without_overwriting_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("result.txt"), "existing").unwrap();
        assert_eq!(
            write_batch(
                dir.path(),
                &[ExportFile {
                    name: "result.txt".into(),
                    content: "new".into()
                }]
            )
            .unwrap(),
            1
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("result.txt")).unwrap(),
            "existing"
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
