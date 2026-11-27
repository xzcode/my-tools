//! Explicit opt-in persistence for all tool workspaces.
//! Native full snapshots use AES-GCM with a randomly generated key held in the
//! platform credential store. A missing/locked key must never fall back to plaintext.
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use keyring::{Entry, Error as KeyringError};
use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

const MAX_BYTES: usize = 32 * 1024 * 1024;
const CONFIG: &[u8] = b"MT-AES-CONFIG\x01";
const FULL: &[u8] = b"MT-AES-WORKSPACE\x01";
const SERVICE: &str = "io.xzcode.mytools";
const ACCOUNT: &str = "aes-workspace-v1";

#[derive(Default)]
pub(crate) struct WorkspaceStore {
    lock: Mutex<()>,
    pub exit_guard: AtomicBool,
    pub exit_pending: AtomicBool,
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|p| p.join("aes-workspace.v1"))
        .map_err(|_| "无法定位 AES 工作台存档目录。".into())
}
fn credential() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|_| "系统安全凭据库不可用。".into())
}

fn read_file(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::metadata(path) {
        Ok(m) if m.len() > (MAX_BYTES + 128) as u64 => Err("AES 工作台存档超过大小限制。".into()),
        Ok(_) => fs::read(path)
            .map(Some)
            .map_err(|_| "无法读取 AES 工作台存档。".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("无法访问 AES 工作台存档。".into()),
    }
}

fn session_key(create: bool) -> Result<Vec<u8>, String> {
    let entry = credential()?;
    match entry.get_secret() {
        Ok(key) if key.len() == 32 => Ok(key),
        Ok(_) => Err("系统安全凭据中的 AES 工作台密钥无效。".into()),
        Err(KeyringError::NoEntry) if create => {
            let mut key = vec![0u8; 32];
            getrandom::fill(&mut key).map_err(|_| "无法生成安全随机密钥。".to_string())?;
            entry
                .set_secret(&key)
                .map_err(|_| "无法保存密钥到系统安全凭据库；未保存敏感工作台。".to_string())?;
            Ok(key)
        }
        Err(KeyringError::NoEntry) => {
            Err("AES 工作台的系统安全密钥不存在；无法恢复加密存档。".into())
        }
        Err(_) => Err("无法读取系统安全凭据；请解锁凭据库后重试。".into()),
    }
}

fn cipher(key: &[u8]) -> Result<Aes256Gcm, String> {
    Aes256Gcm::new_from_slice(key).map_err(|_| "AES 工作台密钥无效。".into())
}
fn seal(key: &[u8], nonce: &[u8; 12], data: &[u8]) -> Result<Vec<u8>, String> {
    let mut output = FULL.to_vec();
    output.extend_from_slice(nonce);
    output.extend(
        cipher(key)?
            .encrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: data,
                    aad: FULL,
                },
            )
            .map_err(|_| "AES 工作台加密失败。".to_string())?,
    );
    Ok(output)
}
fn unseal(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let payload = data.strip_prefix(FULL).ok_or("AES 工作台格式无效。")?;
    if payload.len() < 28 {
        return Err("AES 工作台加密数据不完整。".into());
    }
    cipher(key)?
        .decrypt(
            Nonce::from_slice(&payload[..12]),
            Payload {
                msg: &payload[12..],
                aad: FULL,
            },
        )
        .map_err(|_| "AES 工作台认证失败；可能已损坏或密钥不匹配。".into())
}

fn config_opts(value: &Value) -> bool {
    let Some(obj) = value.as_object() else {
        return false;
    };
    obj.iter().all(|(k, v)| {
        let allowed: &[&str] = match k.as_str() {
            "profile" => &["simple", "advanced"],
            "cipherMode" => &["GCM", "CBC", "ECB"],
            "keySize" => &["128", "192", "256"],
            "keyEncoding" | "ivEncoding" | "dataEncoding" | "aadEncoding" => {
                &["utf8", "hex", "base64"]
            }
            "cipherEncoding" => &["hex", "base64"],
            "padding" => &["pkcs7", "none"],
            "tagLength" => &["96", "104", "112", "120", "128"],
            "tagFormat" => &["appended", "detached"],
            "password" | "rawKey" | "iv" | "prefix" | "aad" => &[""],
            _ => &[],
        };
        v.as_str().is_some_and(|s| allowed.contains(&s))
    })
}
fn metadata_safe(data: &Value) -> bool {
    fn label(value: &Value, max: usize) -> bool {
        value.as_str().is_some_and(|s| s.len() <= max)
    }
    fn id(value: &Value) -> bool {
        value.as_str().is_some_and(|s| {
            s.len() <= 100 && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
    }
    if !data["fields"].as_object().is_some_and(|o| {
        o.len() == 6
            && o.iter().all(|(k, v)| {
                ["key", "iv", "aad", "prefix", "input", "output"].contains(&k.as_str())
                    && v.is_boolean()
            })
    }) || !id(&data["activeId"])
    {
        return false;
    }
    ["tabs", "closed"].iter().all(|key| {
        data[*key].as_array().is_some_and(|tabs| {
            tabs.len() <= if *key == "tabs" { 16 } else { 10 }
                && tabs.iter().all(|tab| {
                    tab.as_object().is_some_and(|o| {
                        o.keys().all(|k| {
                            [
                                "id",
                                "name",
                                "action",
                                "input",
                                "options",
                                "result",
                                "error",
                                "stale",
                                "elapsed",
                                "outputView",
                            ]
                            .contains(&k.as_str())
                        })
                    }) && id(&tab["id"])
                        && label(&tab["name"], 400)
                        && matches!(tab["action"].as_str(), Some("encrypt" | "decrypt"))
                        && tab["input"].as_str() == Some("")
                        && tab["result"].is_null()
                        && tab["error"].as_str() == Some("")
                        && tab["stale"].as_bool() == Some(false)
                        && tab["elapsed"].as_u64() == Some(0)
                        && tab["outputView"].as_str() == Some("text")
                        && config_opts(&tab["options"])
                })
        })
    }) && data["templates"].as_array().is_some_and(|templates| {
        templates.len() <= 30
            && templates.iter().all(|t| {
                t.as_object().is_some_and(|o| {
                    o.keys()
                        .all(|k| ["id", "name", "options"].contains(&k.as_str()))
                }) && id(&t["id"])
                    && label(&t["name"], 400)
                    && config_opts(&t["options"])
            })
    })
}
fn metadata_safe_v2(data: &Value) -> bool {
    let Ok(schema) = serde_json::from_str::<Value>(include_str!("workspace_options.json")) else {
        return false;
    };
    fn id(v: &Value) -> bool {
        v.as_str().is_some_and(|s| {
            !s.is_empty()
                && s.len() <= 100
                && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
    }
    fn label(v: &Value) -> bool {
        v.as_str().is_some_and(|s| s.len() <= 400)
    }
    fn opts(v: &Value, defs: &Value) -> bool {
        v.as_object().is_some_and(|o| {
            o.iter().all(|(k, v)| {
                let def = &defs[k];
                match def["type"].as_str() {
                    Some("select") => def["values"].as_array().is_some_and(|a| a.contains(v)),
                    Some("checkbox") => v.is_boolean(),
                    Some("number") => v.as_f64().is_some_and(|n| {
                        n.is_finite()
                            && n >= def["min"].as_f64().unwrap_or(0.0)
                            && n <= def["max"].as_f64().unwrap_or(100000.0)
                    }),
                    _ => false,
                }
            })
        })
    }
    fn tab(v: &Value, schema: &Value) -> bool {
        let Some(tool) = v["toolId"].as_str() else {
            return false;
        };
        let defs = &schema[tool];
        v.as_object().is_some_and(|o| {
            o.keys().all(|k| {
                [
                    "id",
                    "toolId",
                    "name",
                    "action",
                    "input",
                    "secondaryInput",
                    "options",
                    "result",
                    "error",
                    "stale",
                    "elapsed",
                    "outputView",
                    "fileName",
                    "binarySourceName",
                    "batch",
                    "batchVisible",
                ]
                .contains(&k.as_str())
            })
        }) && id(&v["id"])
            && label(&v["name"])
            && defs["actions"]
                .as_array()
                .is_some_and(|a| a.contains(&v["action"]))
            && opts(&v["options"], &defs["options"])
            && [
                "input",
                "secondaryInput",
                "error",
                "fileName",
                "binarySourceName",
            ]
            .iter()
            .all(|k| v[*k].as_str() == Some(""))
            && v["result"].is_null()
            && v["stale"].as_bool() == Some(false)
            && v["elapsed"].as_u64() == Some(0)
            && v["outputView"].as_str() == Some("text")
            && v["batch"].as_array().is_some_and(|a| a.is_empty())
            && v["batchVisible"].as_bool() == Some(false)
    }
    data.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "version",
                "mode",
                "fields",
                "tabs",
                "activeIds",
                "history",
                "templates",
            ]
            .contains(&k.as_str())
        })
    }) && data["fields"].as_object().is_some_and(|o| {
        o.len() == 6
            && o.iter().all(|(k, v)| {
                ["key", "iv", "aad", "prefix", "input", "output"].contains(&k.as_str())
                    && v.is_boolean()
            })
    }) && data["activeIds"]
        .as_object()
        .is_some_and(|o| o.iter().all(|(k, v)| schema.get(k).is_some() && id(v)))
        && data["tabs"]
            .as_array()
            .is_some_and(|a| a.len() <= 96 && a.iter().all(|v| tab(v, &schema)))
        && data["history"].as_array().is_some_and(|a| {
            a.len() <= 200
                && a.iter().all(|v| {
                    v.as_object().is_some_and(|o| {
                        o.keys()
                            .all(|k| ["id", "at", "type", "tab"].contains(&k.as_str()))
                    }) && id(&v["id"])
                        && v["at"].as_u64().is_some()
                        && matches!(v["type"].as_str(), Some("closed" | "run"))
                        && tab(&v["tab"], &schema)
                })
        })
        && data["templates"].as_array().is_some_and(|a| {
            a.len() <= 30
                && a.iter().all(|t| {
                    t.as_object().is_some_and(|o| {
                        o.keys()
                            .all(|k| ["id", "name", "options"].contains(&k.as_str()))
                    }) && id(&t["id"])
                        && label(&t["name"])
                        && opts(&t["options"], &schema["aes"]["options"])
                })
        })
}
fn validate(data: &str) -> Result<bool, String> {
    if data.len() > MAX_BYTES {
        return Err("工作台自动存档超过 32 MiB；请减少保存内容。".into());
    }
    let value: Value = serde_json::from_str(data).map_err(|_| "AES 工作台存档 JSON 无效。")?;
    if value["version"].as_u64() == Some(2) {
        return match value["mode"].as_str() {
            Some("full") => Ok(true),
            Some("config" | "off") if metadata_safe_v2(&value) => Ok(false),
            _ => Err("仅配置保存拒绝了敏感数据或无效字段。".into()),
        };
    }
    if value["version"].as_u64() != Some(1) {
        return Err("不支持的 AES 工作台存档版本。".into());
    }
    match value["mode"].as_str() {
        Some("full") => Ok(true),
        Some("config" | "off")
            if value.as_object().is_some_and(|o| {
                o.keys().all(|k| {
                    [
                        "version",
                        "mode",
                        "fields",
                        "tabs",
                        "closed",
                        "activeId",
                        "templates",
                    ]
                    .contains(&k.as_str())
                })
            }) && metadata_safe(&value) =>
        {
            Ok(false)
        }
        _ => Err("仅配置保存拒绝了敏感数据或无效字段。".into()),
    }
}
fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("AES 工作台存档目录无效。")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建 AES 工作台存档目录。")?;
    let mut tmp =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建 AES 工作台临时文件。")?;
    tmp.write_all(data).map_err(|_| "AES 工作台写入失败。")?;
    tmp.as_file()
        .sync_all()
        .map_err(|_| "AES 工作台同步磁盘失败。")?;
    tmp.persist(path)
        .map_err(|_| "AES 工作台原子替换失败；旧存档保留。")?;
    #[cfg(unix)]
    if let Ok(dir) = fs::File::open(parent) {
        let _ = dir.sync_all();
    }
    Ok(())
}
fn load_impl(path: &Path) -> Result<Option<String>, String> {
    let Some(data) = read_file(path)? else {
        return Ok(None);
    };
    let (bytes, encrypted) = if let Some(bytes) = data.strip_prefix(CONFIG) {
        (bytes.to_vec(), false)
    } else if data.starts_with(FULL) {
        let mut key = session_key(false)?;
        let result = unseal(&key, &data);
        key.fill(0);
        (result?, true)
    } else {
        return Err("无法识别 AES 工作台存档格式；旧文件未覆盖。".into());
    };
    let json = String::from_utf8(bytes).map_err(|_| "AES 工作台存档编码损坏。")?;
    if validate(&json)? != encrypted {
        return Err("AES 工作台存档安全模式不匹配。".into());
    }
    Ok(Some(json))
}
fn save_impl(path: &Path, data: &str) -> Result<(), String> {
    let full = validate(data)?;
    let output = if full {
        // Never create a replacement key for an existing encrypted vault.
        let existing = read_file(path)?.is_some_and(|bytes| bytes.starts_with(FULL));
        let mut key = session_key(!existing)?;
        let mut nonce = [0u8; 12];
        getrandom::fill(&mut nonce).map_err(|_| "无法生成安全随机 IV。")?;
        let result = seal(&key, &nonce, data.as_bytes());
        key.fill(0);
        result?
    } else {
        [CONFIG, data.as_bytes()].concat()
    };
    atomic_write(path, &output)
}

#[tauri::command]
pub(crate) async fn load_aes_workspace(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<String>, String> {
    super::trusted_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkspaceStore>();
        let _guard = state.lock.lock().map_err(|_| "AES 工作台存储暂不可用。")?;
        load_impl(&path(&app)?)
    })
    .await
    .map_err(|_| "AES 工作台读取任务失败。".to_string())?
}
#[tauri::command]
pub(crate) async fn save_aes_workspace(
    window: WebviewWindow,
    app: AppHandle,
    data: String,
) -> Result<(), String> {
    super::trusted_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkspaceStore>();
        let _guard = state.lock.lock().map_err(|_| "AES 工作台存储暂不可用。")?;
        save_impl(&path(&app)?, &data)
    })
    .await
    .map_err(|_| "AES 工作台保存任务失败。".to_string())?
}
#[tauri::command]
pub(crate) async fn clear_aes_workspace(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<String>, String> {
    super::trusted_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkspaceStore>();
        let _guard = state.lock.lock().map_err(|_| "AES 工作台存储暂不可用。")?;
        let target = path(&app)?;
        match fs::remove_file(&target) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("无法删除 AES 工作台存档。".into()),
        }
        // Clearing the vault removes the stored payload even if the desktop
        // currently has no available keychain (e.g. a headless Linux session).
        let warning = match credential() {
            Ok(entry) => match entry.delete_credential() {
                Ok(()) | Err(KeyringError::NoEntry) => None,
                Err(_) => {
                    Some("工作台文件已清除，但无法确认系统凭据中的存档密钥已删除。".to_string())
                }
            },
            Err(_) => Some("工作台文件已清除，系统凭据库当前不可用。".to_string()),
        };
        Ok(warning)
    })
    .await
    .map_err(|_| "AES 工作台清除任务失败。".to_string())?
}
#[tauri::command]
pub(crate) fn enable_aes_workspace_exit_guard(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<(), String> {
    super::trusted_main(&window)?;
    app.state::<WorkspaceStore>()
        .exit_guard
        .store(true, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
pub(crate) fn finish_aes_workspace_exit(
    window: WebviewWindow,
    app: AppHandle,
    proceed: bool,
) -> Result<(), String> {
    super::trusted_main(&window)?;
    let state = app.state::<WorkspaceStore>();
    state.exit_pending.store(false, Ordering::SeqCst);
    if proceed {
        state.exit_guard.store(false, Ordering::SeqCst);
        app.exit(0);
    }
    Ok(())
}

pub(crate) fn flush_hidden(app: &AppHandle) {
    if app
        .state::<WorkspaceStore>()
        .exit_guard
        .load(Ordering::SeqCst)
    {
        let _ = app.emit_to("main", "my-tools:flush-aes-workspace", false);
    }
}
pub(crate) fn intercept_exit(app: &AppHandle, api: &tauri::ExitRequestApi) {
    let state = app.state::<WorkspaceStore>();
    if !state.exit_guard.load(Ordering::SeqCst) || app.get_webview_window("main").is_none() {
        return;
    }
    if state.exit_pending.swap(true, Ordering::SeqCst) {
        api.prevent_exit();
        return;
    }
    if app
        .emit_to("main", "my-tools:flush-aes-workspace", true)
        .is_ok()
    {
        api.prevent_exit();
    } else {
        state.exit_pending.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_vault_authenticates_and_does_not_contain_plaintext() {
        let key = [7u8; 32];
        let clear = b"test-only-private-workspace-data";
        let mut bytes = seal(&key, &[1; 12], clear).unwrap();
        assert!(!bytes.windows(clear.len()).any(|s| s == clear));
        assert_eq!(unseal(&key, &bytes).unwrap(), clear);
        assert!(unseal(&[8; 32], &bytes).is_err());
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        assert!(unseal(&key, &bytes).is_err());
    }
    #[test]
    fn config_store_rejects_sensitive_values() {
        let data = r#"{"version":1,"mode":"config","fields":{"key":true,"iv":true,"aad":true,"prefix":true,"input":true,"output":true},"activeId":"a","tabs":[{"id":"a","name":"test","action":"encrypt","input":"","options":{"rawKey":"","prefix":"","cipherMode":"ECB"},"result":null,"error":"","stale":false,"elapsed":0,"outputView":"text"}],"closed":[],"templates":[]}"#;
        assert_eq!(validate(data), Ok(false));
        assert!(validate(&data.replace("\"rawKey\":\"\"", "\"rawKey\":\"test-secret\"")).is_err());
        assert!(validate(&data.replace("\"input\":\"\"", "\"input\":\"test-secret\"")).is_err());
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("workspace");
        save_impl(&file, data).unwrap();
        assert_eq!(load_impl(&file).unwrap(), Some(data.to_string()));
    }
    #[test]
    fn unified_config_validates_tool_options_and_history() {
        let data = r#"{"version":2,"mode":"config","fields":{"key":true,"iv":true,"aad":true,"prefix":true,"input":true,"output":true},"activeIds":{"phone":"a"},"tabs":[{"id":"a","toolId":"phone","name":"phone 1","action":"validate","input":"","secondaryInput":"","options":{"country":"CN"},"result":null,"error":"","stale":false,"elapsed":0,"outputView":"text","fileName":"","binarySourceName":"","batch":[],"batchVisible":false}],"history":[],"templates":[]}"#;
        assert_eq!(validate(data), Ok(false));
        let mut v: Value = serde_json::from_str(data).unwrap();
        v["tabs"][0]["options"]["country"] = serde_json::json!("invalid");
        assert!(validate(&v.to_string()).is_err());
        v["tabs"][0]["options"]["country"] = serde_json::json!("MY");
        v["tabs"][0]["options"]["secret"] = serde_json::json!("private");
        assert!(validate(&v.to_string()).is_err());
        v["tabs"][0]["options"]
            .as_object_mut()
            .unwrap()
            .remove("secret");
        let mut tab = v["tabs"][0].clone();
        tab["input"] = serde_json::json!("private");
        v["history"] = serde_json::json!([{"id":"h1","at":100,"type":"closed","tab":tab}]);
        assert!(validate(&v.to_string()).is_err());
    }
}
