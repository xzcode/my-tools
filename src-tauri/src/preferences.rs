use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Write, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub theme: String,
    pub favorites: Vec<String>,
    pub recent: Vec<String>,
    pub shortcut: String,
    pub close_to_tray: bool,
    pub last_tool: String,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            favorites: vec![],
            recent: vec![],
            shortcut: "CmdOrCtrl+Shift+Space".into(),
            close_to_tray: true,
            last_tool: "json".into(),
        }
    }
}

pub fn valid_tool_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

impl Preferences {
    pub fn validate(&mut self) -> Result<(), String> {
        if !["system", "light", "dark"].contains(&self.theme.as_str()) {
            return Err("无效的主题设置".into());
        }
        if self.shortcut.len() > 128 || self.shortcut.chars().any(char::is_control) {
            return Err("快捷键格式无效".into());
        }
        self.shortcut = self.shortcut.trim().to_owned();
        if !valid_tool_id(&self.last_tool) || self.favorites.len() > 100 || self.recent.len() > 20 {
            return Err("工具偏好设置无效".into());
        }
        for list in [&mut self.favorites, &mut self.recent] {
            if !list.iter().all(|id| valid_tool_id(id)) {
                return Err("工具标识只能包含小写字母、数字与连字符".into());
            }
            let mut seen = HashSet::new();
            list.retain(|id| seen.insert(id.clone()));
        }
        Ok(())
    }
}

pub fn read(path: &Path) -> Preferences {
    let read_valid = || -> Option<Preferences> {
        let metadata = fs::metadata(path).ok()?;
        if metadata.len() > 32 * 1024 {
            return None;
        }
        let mut preferences: Preferences = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
        preferences.validate().ok()?;
        Some(preferences)
    };
    read_valid().unwrap_or_default()
}

pub fn write(path: &Path, preferences: &Preferences) -> Result<(), String> {
    let parent = path.parent().ok_or("无法定位应用配置目录")?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建配置目录：{e}"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(&serde_json::to_vec_pretty(preferences).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path)
        .map_err(|e| format!("保存设置失败：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_content_and_unrecognized_preference_fields() {
        let value = serde_json::json!({
            "theme":"system", "favorites":[], "recent":[], "shortcut":"", "closeToTray":true,
            "lastTool":"json", "input":"should never persist"
        });
        assert!(serde_json::from_value::<Preferences>(value).is_err());
    }

    #[test]
    fn rejects_path_ids_and_large_lists() {
        let mut prefs = Preferences {
            last_tool: "../secret".into(),
            ..Default::default()
        };
        assert!(prefs.validate().is_err());
        prefs.last_tool = "json".into();
        prefs.recent = vec!["json".into(); 21];
        assert!(prefs.validate().is_err());
    }

    #[test]
    fn preferences_round_trip_and_replace_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("preferences.json");
        let mut prefs = Preferences::default();
        write(&path, &prefs).unwrap();
        prefs.theme = "dark".into();
        write(&path, &prefs).unwrap();
        assert_eq!(read(&path), prefs);
    }

    #[test]
    fn corrupted_preferences_fall_back_safely() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("preferences.json");
        fs::write(&path, "broken json").unwrap();
        assert_eq!(read(&path), Preferences::default());
    }
}
