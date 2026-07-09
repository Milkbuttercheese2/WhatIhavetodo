use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Tiny app-level config, kept deliberately separate from the SQLite
/// database it points at (a chicken-and-egg problem otherwise: we need to
/// know where the DB is *before* we can open it). Lives at a fixed,
/// well-known location (`app_config_dir()`), unlike the DB itself which
/// this file lets the user relocate.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    /// User-chosen folder to hold `data/wmhh.sqlite` + `backups/`.
    /// None means "use the default app-local-data folder".
    pub data_dir: Option<String>,
}

fn config_path(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join("config.json")
}

pub fn load(app_config_dir: &Path) -> AppConfig {
    fs::read_to_string(config_path(app_config_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app_config_dir: &Path, cfg: &AppConfig) -> Result<(), String> {
    fs::create_dir_all(app_config_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_path(app_config_dir), json).map_err(|e| e.to_string())
}
